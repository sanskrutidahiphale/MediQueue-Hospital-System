import mongoose from 'mongoose';
import 'dotenv/config';
import bcrypt from 'bcryptjs';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/MediCare';

export async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected:', MONGO_URI);
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const prescriptionSchema = new mongoose.Schema({
  medication: String,
  dosage: String,
  frequency: String,
  duration: String,
  author: { id: String, name: String },
  timestamp: { type: Date, default: Date.now }
});

// Appointment — one document per queue visit, persists forever
const appointmentSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  patientId:   { type: String, index: true },          // Patient._id
  tokenNumber: { type: String, required: true },
  queueType:   { type: String, enum: ['normal', 'emergency'], default: 'normal' },
  complaint:   { type: String, default: '' },
  status:      { type: String, enum: ['WAITING', 'SERVING', 'COMPLETED', 'CANCELLED'], default: 'WAITING' },
  createdAt:   { type: Date, default: Date.now },
  servedAt:    { type: Date, default: null },
  completedAt: { type: Date, default: null },
  cancelledAt:  { type: Date, default: null },
  prescriptions: [prescriptionSchema],
  doctorNotes:  { type: String, default: '' },
  tests:        { type: [String], default: [] },
  followUpDate:     { type: Date,    default: null },
  followUpRequired: { type: Boolean, default: false },
  followUpInDays:   { type: Number,  default: null },
  updatedAt:        { type: Date,    default: null },
});

// One document per patient; prescriptions embedded as sub-array
const patientSchema = new mongoose.Schema({
  _id: { type: String },          // use our own id (e.g. 'p-n010')
  name: { type: String, required: true },
  phone: String,
  complaint: String,
  token: String,
  type: { type: String, enum: ['normal', 'emergency'], default: 'normal' },
  status: { type: String, default: 'waiting' },
  waitTime: String,
  pendingTests: [String],
  prescriptions: [prescriptionSchema],
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

// Single-document queue state (singleton pattern — only one doc with _id:'main')
const queueStateSchema = new mongoose.Schema({
  _id: { type: String, default: 'main' },
  normal: { type: Array, default: [] },
  emergency: { type: Array, default: [] },
  pendingEmergency: { type: Array, default: [] },
  serving: { type: Object, default: null },
  stats: {
    totalWaiting: { type: Number, default: 0 },
    emergencies: { type: Number, default: 0 },
    normalQueue: { type: Number, default: 0 },
    avgWaitTime: { type: String, default: '34m' }
  }
}, { _id: false });

const otRoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true },
  status: { type: String, default: 'Available' },
  patientId: { type: String, default: null }
});

const userSchema = new mongoose.Schema({
  name:           { type: String, required: true },
  email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:       { type: String, required: true },
  role:           { type: String, enum: ['admin', 'staff', 'patient', 'doctor'], default: 'patient' },
  activePatientId:{ type: String, default: null },  // links to Patient._id while token is active
  queueStatus:    { type: String, enum: ['WAITING', 'SERVING', 'COMPLETED', 'CANCELLED', null], default: null },
  createdAt:      { type: Date, default: Date.now }
});

userSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export const Patient     = mongoose.model('Patient', patientSchema);
export const Appointment = mongoose.model('Appointment', appointmentSchema);
export const QueueState  = mongoose.model('QueueState', queueStateSchema);
export const OTRoom      = mongoose.model('OTRoom', otRoomSchema);
export const User        = mongoose.model('User', userSchema);
