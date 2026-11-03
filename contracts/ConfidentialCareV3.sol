// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title ConfidentialCareV3
 * @notice Anonymous medical consultation platform powered by Zama FHE — delegation-based access.
 *
 *  PRIVACY MODEL (v3):
 *  ═══════════════════
 *  - Patient symptoms are encrypted client-side into chunks of euint64.
 *  - The contract grants persistent ACL access to the complaint ONLY to itself and the patient.
 *    Doctors never receive an ACL grant, so they cannot re-share via ACL.allow or make the
 *    ciphertext publicly decryptable.
 *  - The patient gives the doctor read access by calling the Zama ACL directly:
 *        ACL.delegateForUserDecryption(doctorWallet, address(this), expirationDate)
 *    and takes it away with ACL.revokeDelegationForUserDecryption(doctorWallet, address(this)).
 *    Delegations expire automatically at `expirationDate`.
 *  - A delegation covers every handle the patient wallet holds in this contract. To keep
 *    doctors isolated from each other, a patient address may only ever consult ONE doctor;
 *    the frontend derives a separate patient wallet per doctor.
 *  - A consultation can only be closed once the doctor's delegation is revoked or expired,
 *    so "closed" implies the doctor can no longer decrypt.
 *  - The doctor's response is ACL-allowed to the contract and the patient only. While the patient's
 *    delegation is active it also covers the response, so the assigned doctor can decrypt their own
 *    reply through it; no other doctor can.
 *
 *  TEXT ENCODING: UTF-8, zero-padded to a multiple of 8 bytes, split into 8-byte euint64
 *  chunks. Max 32 chunks = 256 bytes.
 */
contract ConfidentialCareV3 is ZamaEthereumConfig {

    // ─────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────

    uint8 public constant MAX_CHUNKS = 32;   // 32 × 8 bytes = 256 chars max
    uint8 public constant MAX_DOCTORS = 100;

    // ─────────────────────────────────────────────
    //  Roles & Access
    // ─────────────────────────────────────────────

    address public admin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    // ─────────────────────────────────────────────
    //  Doctor Registry
    // ─────────────────────────────────────────────

    struct Doctor {
        uint256 id;
        address wallet;
        string  name;
        string  specialty;
        string  credentials;
        bool    active;
        uint256 consultationCount;
    }

    uint256 public doctorCount;
    mapping(uint256 => Doctor) public doctors;
    mapping(address => uint256) public doctorIdByAddress; // wallet => doctorId
    mapping(address => bool)    public isDoctor;

    // ─────────────────────────────────────────────
    //  Consultation
    // ─────────────────────────────────────────────

    enum ConsultStatus { Open, DoctorResponded, Closed }

    struct Consultation {
        uint256 id;
        address patient;
        uint256 doctorId;
        ConsultStatus status;
        uint256 createdAt;
        euint64[MAX_CHUNKS] complaintChunks;
        uint8   complaintChunkCount;
        euint64[MAX_CHUNKS] responseChunks;
        uint8   responseChunkCount;
        bool    hasResponse;
    }

    uint256 public consultationCount;
    mapping(uint256 => Consultation) private consultations;

    mapping(address => uint256[]) public patientConsultations;
    mapping(uint256 => uint256[]) public doctorConsultations;

    /// @notice The only doctor a patient address may consult (0 = not bound yet).
    mapping(address => uint256) public patientDoctor;

    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────

    event DoctorAdded(uint256 indexed doctorId, address indexed wallet, string name, string specialty);
    event DoctorDeactivated(uint256 indexed doctorId);

    event ConsultationCreated(
        uint256 indexed consultationId,
        address indexed patient,
        uint256 indexed doctorId,
        uint256 createdAt
    );

    event ResponseSubmitted(uint256 indexed consultationId, uint256 indexed doctorId);
    event ConsultationClosed(uint256 indexed consultationId);

    // ─────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────

    modifier consultExists(uint256 id) {
        require(id > 0 && id <= consultationCount, "Consultation does not exist");
        _;
    }

    modifier onlyPatient(uint256 consultId) {
        require(consultations[consultId].patient == msg.sender, "Not the patient");
        _;
    }

    modifier onlyAssignedDoctor(uint256 consultId) {
        uint256 docId = doctorIdByAddress[msg.sender];
        require(docId > 0, "Not a registered doctor");
        require(consultations[consultId].doctorId == docId, "Not assigned to this consultation");
        _;
    }

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────

    constructor() {
        admin = msg.sender;
    }

    // ─────────────────────────────────────────────
    //  Admin: Doctor Registry
    // ─────────────────────────────────────────────

    function addDoctor(
        address wallet,
        string calldata name,
        string calldata specialty,
        string calldata credentials
    ) external onlyAdmin {
        require(wallet != address(0), "Invalid address");
        require(!isDoctor[wallet], "Already registered");
        require(patientDoctor[wallet] == 0, "Wallet is a patient");
        require(bytes(name).length > 0, "Name required");
        require(bytes(specialty).length > 0, "Specialty required");
        require(doctorCount < MAX_DOCTORS, "Doctor limit reached");

        doctorCount++;
        uint256 docId = doctorCount;

        doctors[docId] = Doctor({
            id: docId,
            wallet: wallet,
            name: name,
            specialty: specialty,
            credentials: credentials,
            active: true,
            consultationCount: 0
        });

        doctorIdByAddress[wallet] = docId;
        isDoctor[wallet] = true;

        emit DoctorAdded(docId, wallet, name, specialty);
    }

    function deactivateDoctor(uint256 doctorId) external onlyAdmin {
        require(doctorId > 0 && doctorId <= doctorCount, "Doctor not found");
        doctors[doctorId].active = false;
        emit DoctorDeactivated(doctorId);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid address");
        admin = newAdmin;
    }

    // ─────────────────────────────────────────────
    //  Patient: Submit Consultation
    // ─────────────────────────────────────────────

    /**
     * @notice Submit a consultation with FHE-encrypted symptoms.
     * @dev The calling address becomes bound to `doctorId` forever: a delegation from this
     *      address covers all of its handles in this contract, so it must never be shared
     *      between doctors. Only the contract and the patient receive ACL access.
     */
    function submitConsultation(
        uint256 doctorId,
        externalEuint64[MAX_CHUNKS] calldata encryptedChunks,
        bytes calldata inputProof,
        uint8 chunkCount
    ) external {
        require(doctorId > 0 && doctorId <= doctorCount, "Doctor not found");
        require(doctors[doctorId].active, "Doctor not active");
        require(chunkCount > 0 && chunkCount <= MAX_CHUNKS, "Invalid chunk count");
        // Fresh inputs bound to msg.sender only (see v2: empty proofs allowed handle reuse).
        require(inputProof.length > 0, "Input proof required");
        require(!isDoctor[msg.sender], "Doctors cannot be patients");

        uint256 bound = patientDoctor[msg.sender];
        if (bound == 0) {
            patientDoctor[msg.sender] = doctorId;
        } else {
            require(bound == doctorId, "Patient wallet bound to another doctor");
        }

        consultationCount++;
        uint256 consultId = consultationCount;

        Consultation storage c = consultations[consultId];
        c.id          = consultId;
        c.patient     = msg.sender;
        c.doctorId    = doctorId;
        c.status      = ConsultStatus.Open;
        c.createdAt   = block.timestamp;
        c.complaintChunkCount = chunkCount;
        c.hasResponse = false;

        for (uint8 i = 0; i < chunkCount; i++) {
            euint64 chunk = FHE.fromExternal(encryptedChunks[i], inputProof);
            c.complaintChunks[i] = chunk;

            FHE.allowThis(chunk);
            FHE.allow(chunk, msg.sender);
        }

        patientConsultations[msg.sender].push(consultId);
        doctorConsultations[doctorId].push(consultId);
        doctors[doctorId].consultationCount++;

        emit ConsultationCreated(consultId, msg.sender, doctorId, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  Doctor: Submit Encrypted Response
    // ─────────────────────────────────────────────

    function submitResponse(
        uint256 consultId,
        externalEuint64[MAX_CHUNKS] calldata encryptedChunks,
        bytes calldata inputProof,
        uint8 chunkCount
    )
        external
        consultExists(consultId)
        onlyAssignedDoctor(consultId)
    {
        Consultation storage c = consultations[consultId];
        require(c.status == ConsultStatus.Open, "Consultation not open");
        require(!c.hasResponse, "Response already submitted");
        require(chunkCount > 0 && chunkCount <= MAX_CHUNKS, "Invalid chunk count");
        require(inputProof.length > 0, "Input proof required");

        c.responseChunkCount = chunkCount;
        c.hasResponse = true;

        address patientWallet = c.patient;

        for (uint8 i = 0; i < chunkCount; i++) {
            euint64 chunk = FHE.fromExternal(encryptedChunks[i], inputProof);
            c.responseChunks[i] = chunk;

            // Only this contract and the patient. (An active delegation from the patient also covers it.)
            FHE.allowThis(chunk);
            FHE.allow(chunk, patientWallet);
        }

        c.status = ConsultStatus.DoctorResponded;

        emit ResponseSubmitted(consultId, c.doctorId);
    }

    // ─────────────────────────────────────────────
    //  Patient: Close Consultation
    // ─────────────────────────────────────────────

    /**
     * @notice Close a consultation. Only possible once the doctor can no longer decrypt.
     * @dev The contract cannot revoke a delegation made by the patient, so it requires the patient
     *      to revoke it (or let it expire) first. Uses the same check the KMS applies.
     *      Revoking ends access to ALL consultations of this patient wallet with this doctor.
     */
    function closeConsultation(uint256 consultId)
        external
        consultExists(consultId)
        onlyPatient(consultId)
    {
        require(!isDoctorDelegated(consultId), "Revoke doctor delegation first");
        consultations[consultId].status = ConsultStatus.Closed;
        emit ConsultationClosed(consultId);
    }

    // ─────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────

    /// @notice Whether the assigned doctor currently holds an active decryption delegation
    ///         from the patient for this consultation's complaint.
    function isDoctorDelegated(uint256 consultId) public view consultExists(consultId) returns (bool) {
        Consultation storage c = consultations[consultId];
        return FHE.isDelegatedForUserDecryption(
            c.patient,
            doctors[c.doctorId].wallet,
            address(this),
            euint64.unwrap(c.complaintChunks[0])
        );
    }

    function getComplaintHandles(uint256 consultId)
        external
        view
        consultExists(consultId)
        returns (euint64[] memory handles, uint8 count)
    {
        Consultation storage c = consultations[consultId];
        count = c.complaintChunkCount;
        handles = new euint64[](count);
        for (uint8 i = 0; i < count; i++) {
            handles[i] = c.complaintChunks[i];
        }
    }

    function getResponseHandles(uint256 consultId)
        external
        view
        consultExists(consultId)
        returns (euint64[] memory handles, uint8 count)
    {
        Consultation storage c = consultations[consultId];
        require(c.hasResponse, "No response yet");
        count = c.responseChunkCount;
        handles = new euint64[](count);
        for (uint8 i = 0; i < count; i++) {
            handles[i] = c.responseChunks[i];
        }
    }

    function getConsultationMeta(uint256 consultId)
        external
        view
        consultExists(consultId)
        returns (
            address patient,
            uint256 doctorId,
            ConsultStatus status,
            uint256 createdAt,
            uint8   complaintChunkCount,
            bool    hasResponse,
            uint8   responseChunkCount
        )
    {
        Consultation storage c = consultations[consultId];
        return (
            c.patient,
            c.doctorId,
            c.status,
            c.createdAt,
            c.complaintChunkCount,
            c.hasResponse,
            c.responseChunkCount
        );
    }

    function getPatientConsultations(address patient) external view returns (uint256[] memory) {
        return patientConsultations[patient];
    }

    function getDoctorConsultations(uint256 doctorId) external view returns (uint256[] memory) {
        return doctorConsultations[doctorId];
    }

    function getAllDoctorIds() external view returns (uint256[] memory ids) {
        ids = new uint256[](doctorCount);
        for (uint256 i = 0; i < doctorCount; i++) {
            ids[i] = i + 1;
        }
    }
}
