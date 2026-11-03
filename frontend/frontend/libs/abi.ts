// ConfidentialCareV3
const ABI = [
  // Admin
  "function admin() view returns (address)",
  "function addDoctor(address wallet, string name, string specialty, string credentials)",
  "function deactivateDoctor(uint256 doctorId)",
  "function transferAdmin(address newAdmin)",

  // Doctor registry reads
  "function doctorCount() view returns (uint256)",
  "function getAllDoctorIds() view returns (uint256[])",
  "function doctors(uint256 id) view returns (uint256 id, address wallet, string name, string specialty, string credentials, bool active, uint256 consultationCount)",
  "function doctorIdByAddress(address) view returns (uint256)",
  "function isDoctor(address) view returns (bool)",

  // Patient actions (sent from the per-doctor patient wallet)
  "function submitConsultation(uint256 doctorId, bytes32[32] encryptedChunks, bytes inputProof, uint8 chunkCount)",
  "function closeConsultation(uint256 consultId)",
  "function patientDoctor(address) view returns (uint256)",

  // Doctor actions
  "function submitResponse(uint256 consultId, bytes32[32] encryptedChunks, bytes inputProof, uint8 chunkCount)",

  // Consultation reads
  "function consultationCount() view returns (uint256)",
  "function getConsultationMeta(uint256 consultId) view returns (address patient, uint256 doctorId, uint8 status, uint256 createdAt, uint8 complaintChunkCount, bool hasResponse, uint8 responseChunkCount)",
  "function getPatientConsultations(address patient) view returns (uint256[])",
  "function getDoctorConsultations(uint256 doctorId) view returns (uint256[])",
  "function getComplaintHandles(uint256 consultId) view returns (bytes32[] handles, uint8 count)",
  "function getResponseHandles(uint256 consultId) view returns (bytes32[] handles, uint8 count)",
  "function isDoctorDelegated(uint256 consultId) view returns (bool)",

  // Events
  "event DoctorAdded(uint256 indexed doctorId, address indexed wallet, string name, string specialty)",
  "event DoctorDeactivated(uint256 indexed doctorId)",
  "event ConsultationCreated(uint256 indexed consultationId, address indexed patient, uint256 indexed doctorId, uint256 createdAt)",
  "event ResponseSubmitted(uint256 indexed consultationId, uint256 indexed doctorId)",
  "event ConsultationClosed(uint256 indexed consultationId)",
];

export default ABI;
