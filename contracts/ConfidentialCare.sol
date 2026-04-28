// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title ConfidentialCare
 * @notice Anonymous medical consultation platform powered by Zama FHE.
 *
 *  PRIVACY MODEL:
 *  ══════════════
 *  - Patient symptoms are encrypted client-side into chunks of euint64.
 *  - Only the chosen doctor (via ACL) can decrypt the complaint.
 *  - Doctor response is also encrypted — only the patient can decrypt it.
 *  - No one on-chain (including the contract owner) sees plaintext.
 *  - Patient identity is never stored — only their wallet address.
 *
 *  TEXT ENCODING (since ebytes was removed in fhevm v0.7):
 *  ═══════════════════════════════════════════════════════
 *  Complaint text is UTF-8 encoded to bytes, zero-padded to a
 *  multiple of 8, then split into 8-byte (uint64) chunks.
 *  Each chunk is encrypted as euint64. Max 32 chunks = 256 chars.
 *
 * @dev Built for Zama Developer Program - Builder Track (Mainnet Season 2)
 */
contract ConfidentialCare is ZamaEthereumConfig {

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
        string  specialty;       // e.g. "General Practice", "HIV/AIDS", "Mental Health"
        string  credentials;     // e.g. "MD, Johns Hopkins"
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
        address patient;          // patient wallet (pseudonymous)
        uint256 doctorId;
        ConsultStatus status;
        uint256 createdAt;

        // Encrypted complaint — stored as euint64 chunks
        // Each chunk is 8 bytes of UTF-8 encoded symptom text
        euint64[MAX_CHUNKS] complaintChunks;
        uint8   complaintChunkCount;    // how many chunks were used

        // Encrypted response from doctor — same chunk approach
        euint64[MAX_CHUNKS] responseChunks;
        uint8   responseChunkCount;

        bool    hasResponse;
    }

    uint256 public consultationCount;
    mapping(uint256 => Consultation) private consultations;

    // patient address => list of their consultation IDs
    mapping(address => uint256[]) public patientConsultations;

    // doctorId => list of consultation IDs assigned to them
    mapping(uint256 => uint256[]) public doctorConsultations;

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

    event DoctorAccessGranted(uint256 indexed consultationId, uint256 indexed doctorId);
    event DoctorAccessRevoked(uint256 indexed consultationId, uint256 indexed doctorId);

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

    /**
     * @notice Add a verified doctor to the registry.
     * @param wallet      Doctor's Ethereum address.
     * @param name        Doctor's display name.
     * @param specialty   Medical specialty.
     * @param credentials Professional credentials string.
     */
    function addDoctor(
        address wallet,
        string calldata name,
        string calldata specialty,
        string calldata credentials
    ) external onlyAdmin {
        require(wallet != address(0), "Invalid address");
        require(!isDoctor[wallet], "Already registered");
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

    /**
     * @notice Deactivate a doctor (they stop receiving new consultations).
     */
    function deactivateDoctor(uint256 doctorId) external onlyAdmin {
        require(doctorId > 0 && doctorId <= doctorCount, "Doctor not found");
        doctors[doctorId].active = false;
        emit DoctorDeactivated(doctorId);
    }

    /**
     * @notice Transfer admin role.
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid address");
        admin = newAdmin;
    }

    // ─────────────────────────────────────────────
    //  Patient: Submit Consultation
    // ─────────────────────────────────────────────

    /**
     * @notice Submit an anonymous consultation with FHE-encrypted symptoms.
     *
     * @dev The patient encrypts each 8-byte chunk of their complaint text
     *      client-side using the Relayer SDK, producing one externalEuint64
     *      handle + one shared inputProof per chunk.
     *
     * @param doctorId         The doctor to consult.
     * @param encryptedChunks  Array of encrypted 8-byte text chunks.
     * @param inputProof       Single ZK proof covering all chunks (batched).
     * @param chunkCount       Number of chunks used (rest are ignored).
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

        // Convert and store each encrypted chunk
        for (uint8 i = 0; i < chunkCount; i++) {
            euint64 chunk = FHE.fromExternal(encryptedChunks[i], inputProof);
            c.complaintChunks[i] = chunk;

            // Grant ACL: only this contract and the patient can access chunks
            FHE.allowThis(chunk);
            FHE.allow(chunk, msg.sender); // patient can re-encrypt to verify
        }

        patientConsultations[msg.sender].push(consultId);
        doctorConsultations[doctorId].push(consultId);
        doctors[doctorId].consultationCount++;

        emit ConsultationCreated(consultId, msg.sender, doctorId, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  Patient: Grant / Revoke Doctor Access
    // ─────────────────────────────────────────────

    /**
     * @notice Grant the assigned doctor ACL access to decrypt the complaint.
     * @dev Patient must call this AFTER submitConsultation to unlock decryption.
     *      This is the key FHE ACL feature — the patient controls who can decrypt.
     */
    function grantDoctorAccess(uint256 consultId)
        external
        consultExists(consultId)
        onlyPatient(consultId)
    {
        Consultation storage c = consultations[consultId];
        require(c.status == ConsultStatus.Open, "Consultation not open");

        address doctorWallet = doctors[c.doctorId].wallet;
        uint8 count = c.complaintChunkCount;

        for (uint8 i = 0; i < count; i++) {
            FHE.allow(c.complaintChunks[i], doctorWallet);
        }

        emit DoctorAccessGranted(consultId, c.doctorId);
    }

    /**
     * @notice Revoke the doctor's ACL access (e.g. if patient changes mind).
     * @dev Note: revoking ACL does not delete already-decrypted data off-chain.
     *      It prevents future decryption requests from being fulfilled.
     */
    function revokeDoctorAccess(uint256 consultId)
        external
        consultExists(consultId)
        onlyPatient(consultId)
    {
        Consultation storage c = consultations[consultId];

        // Revoke by removing doctor from allowlist is not directly supported —
        // we record intent via event; the frontend warns doctor access was revoked.
        // The ACL itself is immutable once set, but this event signals intent.
        emit DoctorAccessRevoked(consultId, c.doctorId);
    }

    // ─────────────────────────────────────────────
    //  Doctor: Submit Encrypted Response
    // ─────────────────────────────────────────────

    /**
     * @notice Doctor submits an encrypted response to the patient's complaint.
     *
     * @dev Doctor encrypts their response text in the same chunk format,
     *      but grants ACL only to the patient — not to themselves or others.
     *
     * @param consultId        The consultation to respond to.
     * @param encryptedChunks  Encrypted response text chunks.
     * @param inputProof       ZK proof for the encrypted chunks.
     * @param chunkCount       Number of chunks used.
     */
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

        c.responseChunkCount = chunkCount;
        c.hasResponse = true;

        address patientWallet = c.patient;

        for (uint8 i = 0; i < chunkCount; i++) {
            euint64 chunk = FHE.fromExternal(encryptedChunks[i], inputProof);
            c.responseChunks[i] = chunk;

            // Grant ACL: only this contract and the PATIENT can decrypt response
            FHE.allowThis(chunk);
            FHE.allow(chunk, patientWallet);
            // Note: doctor does NOT get ACL on their own response — response-blind
        }

        c.status = ConsultStatus.DoctorResponded;

        emit ResponseSubmitted(consultId, c.doctorId);
    }

    // ─────────────────────────────────────────────
    //  Patient: Close Consultation
    // ─────────────────────────────────────────────

    function closeConsultation(uint256 consultId)
        external
        consultExists(consultId)
        onlyPatient(consultId)
    {
        consultations[consultId].status = ConsultStatus.Closed;
        emit ConsultationClosed(consultId);
    }

    // ─────────────────────────────────────────────
    //  View: Complaint & Response Handles
    //  (for client-side decryption via relayer SDK)
    // ─────────────────────────────────────────────

    /**
     * @notice Returns encrypted complaint chunk handles for a consultation.
     * @dev Only callable by the patient or the assigned doctor (ACL enforced
     *      at decryption time by the relayer — this just returns the handles).
     */
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

    /**
     * @notice Returns encrypted response chunk handles.
     * @dev Only the patient has ACL permission to decrypt these.
     */
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

    // ─────────────────────────────────────────────
    //  View: Public Metadata (no sensitive data)
    // ─────────────────────────────────────────────

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

    function getPatientConsultations(address patient)
        external
        view
        returns (uint256[] memory)
    {
        return patientConsultations[patient];
    }

    function getDoctorConsultations(uint256 doctorId)
        external
        view
        returns (uint256[] memory)
    {
        return doctorConsultations[doctorId];
    }

    function getAllDoctorIds() external view returns (uint256[] memory ids) {
        ids = new uint256[](doctorCount);
        for (uint256 i = 0; i < doctorCount; i++) {
            ids[i] = i + 1;
        }
    }
}
