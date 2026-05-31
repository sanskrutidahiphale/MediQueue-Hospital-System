import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { connectDB, Patient, Appointment, QueueState, OTRoom, User } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Seed data ─────────────────────────────────────────────────────────────────

const SEED_QUEUE = {
  _id: 'main',
  normal: [
    { id: 'p-n010', token: 'N-010', name: 'Emma Watson',      complaint: 'Persistent fever',   waitTime: 'about 1 hour', type: 'normal' },
    { id: 'p-n011', token: 'N-011', name: 'James Rodriguez',  complaint: 'Sprained ankle',     waitTime: 'about 1 hour', type: 'normal' },
    { id: 'p-n012', token: 'N-012', name: 'Linda Martinez',   complaint: 'Migraine',           waitTime: '33 minutes',   type: 'normal' },
    { id: 'p-n013', token: 'N-013', name: 'Robert Smith',     complaint: 'Allergic reaction',  waitTime: '23 minutes',   type: 'normal' },
    { id: 'p-n014', token: 'N-014', name: 'William Jones',    complaint: 'Routine checkup',    waitTime: '13 minutes',   type: 'normal' }
  ],
  emergency: [
    { id: 'p-e002', token: 'E-002', name: 'Michael Chang', complaint: 'Deep laceration', waitTime: '18 minutes', type: 'emergency' }
  ],
  pendingEmergency: [
    { id: 'p-n012-pending', token: 'N-012', name: 'Linda Martinez', complaint: 'Migraine', type: 'emergency', status: 'pending' }
  ],
  serving: { id: 'p-e001', token: 'E-001', name: 'Sarah Jenkins', complaint: 'Severe chest pain', type: 'emergency' },
  stats: { totalWaiting: 6, emergencies: 1, normalQueue: 5, avgWaitTime: '34m' }
};

const SEED_PATIENTS = [
  { _id: 'p-n010', name: 'Emma Watson',     phone: '555-0110', complaint: 'Persistent fever',  token: 'N-010', type: 'normal',    prescriptions: [{ medication: 'Paracetamol', dosage: '500mg', frequency: 'Twice daily', duration: '3 days', author: { name: 'Dr. Smith' } }] },
  { _id: 'p-n011', name: 'James Rodriguez', phone: '555-0111', complaint: 'Sprained ankle',    token: 'N-011', type: 'normal',    prescriptions: [] },
  { _id: 'p-n012', name: 'Linda Martinez',  phone: '555-0112', complaint: 'Migraine',          token: 'N-012', type: 'normal',    prescriptions: [] },
  { _id: 'p-n013', name: 'Robert Smith',    phone: '555-0113', complaint: 'Allergic reaction', token: 'N-013', type: 'normal',    prescriptions: [] },
  { _id: 'p-n014', name: 'William Jones',   phone: '555-0114', complaint: 'Routine checkup',   token: 'N-014', type: 'normal',    prescriptions: [] },
  { _id: 'p-e001', name: 'Sarah Jenkins',   phone: '555-0101', complaint: 'Severe chest pain', token: 'E-001', type: 'emergency', prescriptions: [{ medication: 'Aspirin', dosage: '75mg', frequency: 'Once daily', duration: '5 days', author: { name: 'Dr. Lee' } }] },
  { _id: 'p-e002', name: 'Michael Chang',   phone: '555-0102', complaint: 'Deep laceration',   token: 'E-002', type: 'emergency', prescriptions: [] },
];

const SEED_OT = [
  { roomId: 'OT-1', status: 'Available', patientId: null },
  { roomId: 'OT-2', status: 'Available', patientId: null },
  { roomId: 'OT-3', status: 'Available', patientId: null },
];

async function seedIfEmpty() {
  const qCount = await QueueState.countDocuments();
  if (qCount === 0) await QueueState.create(SEED_QUEUE);

  const pCount = await Patient.countDocuments();
  if (pCount === 0) await Patient.insertMany(SEED_PATIENTS);

  const otCount = await OTRoom.countDocuments();
  if (otCount === 0) await OTRoom.insertMany(SEED_OT);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function updateStats(queue) {
  queue.stats.totalWaiting = queue.normal.length + queue.emergency.length;
  queue.stats.emergencies  = queue.emergency.length;
  queue.stats.normalQueue  = queue.normal.length;
}

function getNextToken(queue, type) {
  const prefix = type === 'emergency' ? 'E' : 'N';
  const offset = type === 'emergency' ? 1 : 10;
  let count = 0;
  if (queue.serving?.type === type) count++;
  count += type === 'emergency'
    ? queue.emergency.length + queue.pendingEmergency.length
    : queue.normal.length;
  return `${prefix}-${String(count + offset).padStart(3, '0')}`;
}

async function saveQueue(queue) {
  await QueueState.findByIdAndUpdate('main', queue, { upsert: true });
}

// ── Server ────────────────────────────────────────────────────────────────────

async function startServer() {
  await connectDB();
  await seedIfEmpty();

  // Load queue from DB into memory (single source of truth for real-time ops)
  let queue = (await QueueState.findById('main')).toObject();

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

  app.use(express.json());

  // ── Auth REST endpoints ───────────────────────────────────────────────────────

  app.post('/api/signup', async (req, res) => {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });
    const user = await User.create({ name, email, password, role: role || 'patient' });
    res.status(201).json({ message: 'Account created successfully.', userId: user._id, role: user.role });
  });

  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

    // Restore active token if patient has one in WAITING or SERVING state
    let activeToken = null;
    if (user.activePatientId && ['WAITING', 'SERVING'].includes(user.queueStatus)) {
      // Look up the token in the live in-memory queue first (fastest)
      const allEntries = [
        ...queue.normal,
        ...queue.emergency,
        ...queue.pendingEmergency,
        ...(queue.serving ? [queue.serving] : []),
      ];
      activeToken = allEntries.find(p => p.id === user.activePatientId) || null;

      // If not in memory (e.g. server restarted), fall back to DB
      if (!activeToken) {
        const dbPatient = await Patient.findById(user.activePatientId).lean();
        if (dbPatient && dbPatient.status === 'waiting') {
          activeToken = {
            id:        dbPatient._id,
            token:     dbPatient.token,
            name:      dbPatient.name,
            complaint: dbPatient.complaint,
            type:      dbPatient.type,
            status:    dbPatient.status,
            waitTime:  dbPatient.waitTime || 'about 1 hour',
          };
          // Re-inject into live queue if missing (server restart recovery)
          const inQueue = queue.normal.some(p => p.id === activeToken.id) ||
                          queue.emergency.some(p => p.id === activeToken.id);
          if (!inQueue) {
            const list = activeToken.type === 'emergency' ? queue.emergency : queue.normal;
            list.push(activeToken);
            updateStats(queue);
            await saveQueue(queue);
            io.emit('queueUpdate', queue);
          }
        } else {
          // Token no longer active — clear stale reference
          await User.findByIdAndUpdate(user._id, { activePatientId: null, queueStatus: null });
        }
      }
    }

    res.json({
      message:     'Login successful.',
      userId:      user._id,
      name:        user.name,
      role:        user.role,
      activeToken: activeToken || null,
    });
  });

  // GET appointment history for a user — sorted latest first
  app.get('/api/users/:userId/appointments', async (req, res) => {
    try {
      const appointments = await Appointment
        .find({ userId: req.params.userId })
        .sort({ createdAt: -1 })
        .lean();
      res.json(appointments);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch appointments.' });
    }
  });

  // GET follow-up appointments for a user — only those with followUpRequired = true
  app.get('/api/users/:userId/followups', async (req, res) => {
    try {
      const followups = await Appointment
        .find({ userId: req.params.userId, followUpRequired: true })
        .sort({ followUpDate: 1 })
        .lean();
      res.json(followups);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch follow-ups.' });
    }
  });

  // POST prescription to an appointment by ID
  app.post('/api/appointments/:appointmentId/prescription', async (req, res) => {
    try {
      const { medicines, doctorName, socketId, doctorNotes, tests, followUpRequired, followUpInDays } = req.body;
      if (!medicines || !Array.isArray(medicines) || medicines.length === 0)
        return res.status(400).json({ error: 'At least one medicine is required.' });

      const appt = await Appointment.findById(req.params.appointmentId);
      if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
      if (!['WAITING', 'SERVING'].includes(appt.status))
        return res.status(400).json({ error: 'Cannot add prescription to a completed or cancelled appointment.' });

      const validRows = medicines.filter(m => m.name?.trim());
      if (!validRows.length) return res.status(400).json({ error: 'No valid medicines provided.' });

      const medication = validRows.map(r => r.name.trim()).join(', ');
      const frequency  = validRows.map(r => {
        const times = [r.morning && 'Morning', r.afternoon && 'Afternoon', r.night && 'Night'].filter(Boolean);
        return `${r.name.trim()}: ${times.length ? times.join('+') : 'As directed'}`;
      }).join(' | ');

      const entry = {
        medication,
        dosage:    JSON.stringify(validRows),
        frequency,
        duration:  'As prescribed',
        author:    { id: socketId || 'api', name: doctorName || 'Doctor' },
        timestamp: new Date(),
      };

      // Save prescription + notes + tests to Appointment
      appt.prescriptions.push(entry);
      if (doctorNotes)   appt.doctorNotes = doctorNotes;
      if (tests?.length) appt.tests       = tests;

      // Follow-up: compute date server-side from interval
      const days = Number(followUpInDays);
      if (followUpRequired === true && days > 0) {
        appt.followUpRequired = true;
        appt.followUpInDays   = days;
        appt.followUpDate     = new Date(Date.now() + days * 86400000);
      } else {
        appt.followUpRequired = false;
        appt.followUpInDays   = null;
        appt.followUpDate     = null;
      }

      appt.updatedAt = new Date();
      await appt.save();

      // Mirror prescription to Patient document
      await Patient.findByIdAndUpdate(
        appt.patientId,
        { $push: { prescriptions: entry } },
        { upsert: true }
      );

      // Broadcast to all connected clients
      io.emit('medicalHistoryUpdate', { patientId: appt.patientId, history: appt.prescriptions });
      // Keep queue.serving in sync so button state updates without reload
      if (queue.serving?.id === appt.patientId) {
        queue.serving.prescriptions = appt.prescriptions;
        await saveQueue(queue);
        io.emit('queueUpdate', queue);
      }

      res.json({
        message:      'Prescription saved.',
        prescription: entry,
        appointmentId: appt._id,
        followUpDate:  appt.followUpDate,
        followUpInDays: appt.followUpInDays,
      });
    } catch (err) {
      console.error('Prescription save error:', err);
      res.status(500).json({ error: 'Failed to save prescription.' });
    }
  });

  // GET single appointment with full prescription detail
  app.get('/api/appointments/:appointmentId', async (req, res) => {
    try {
      const appt = await Appointment.findById(req.params.appointmentId).lean();
      if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
      res.json(appt);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch appointment.' });
    }
  });

  app.get('/api/patients/:patientId/history', async (req, res) => {
    try {
      const doc = await Patient.findById(req.params.patientId).lean();
      if (!doc) return res.json([]);
      // Group prescriptions by date (YYYY-MM-DD) to simulate appointment grouping.
      // Each unique calendar day becomes one "appointment" entry.
      const byDate = {};
      for (const rx of (doc.prescriptions || [])) {
        const day = new Date(rx.timestamp).toISOString().slice(0, 10);
        if (!byDate[day]) byDate[day] = { date: day, complaint: doc.complaint || '', prescriptions: [] };
        // Parse structured dosage JSON if present, otherwise fall back to plain string
        let structured = null;
        try { structured = JSON.parse(rx.dosage); } catch (_) {}
        byDate[day].prescriptions.push({
          medication: rx.medication,
          frequency:  rx.frequency,
          duration:   rx.duration,
          author:     rx.author?.name || 'Doctor',
          timestamp:  rx.timestamp,
          medicines:  Array.isArray(structured) ? structured : null,
        });
      }
      // Sort newest first
      const history = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
      res.json(history);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch history.' });
    }
  });

  // ── Socket events ────────────────────────────────────────────────────────────

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.emit('queueUpdate', queue);

    // Patient: register normal
    socket.on('registerNormal', async (data) => {
      // Prevent duplicate registration for the same user
      if (data.userId) {
        const existingUser = await User.findById(data.userId);
        if (existingUser?.activePatientId && ['WAITING', 'SERVING'].includes(existingUser.queueStatus)) {
          const existing = [...queue.normal, ...queue.emergency].find(p => p.id === existingUser.activePatientId);
          if (existing) { socket.emit('registrationSuccess', existing); return; }
        }
      }

      const id    = data.userId || Math.random().toString(36).substr(2, 9);
      const token = getNextToken(queue, 'normal');
      const patient = { ...data, id, token, type: 'normal', status: 'waiting', waitTime: 'about 1 hour', timestamp: new Date().toISOString() };
      queue.normal.push(patient);
      updateStats(queue);
      await saveQueue(queue);
      await Patient.findByIdAndUpdate(id, { _id: id, name: data.name, phone: data.phone, complaint: data.complaint, token, type: 'normal', status: 'waiting' }, { upsert: true });
      // Create a persistent Appointment record
      const appt = await Appointment.create({
        userId:      data.userId || null,
        patientId:   id,
        tokenNumber: token,
        queueType:   'normal',
        complaint:   data.complaint || '',
        status:      'WAITING',
      });
      // Link token to user account for session persistence
      if (data.userId) {
        await User.findByIdAndUpdate(data.userId, { activePatientId: id, queueStatus: 'WAITING' });
      }
      io.emit('queueUpdate', queue);
      socket.emit('registrationSuccess', { ...patient, appointmentId: String(appt._id) });
    });

    // Patient: request emergency
    socket.on('requestEmergency', async (data) => {
      const id = data.existingId || Math.random().toString(36).substr(2, 9);
      const token = getNextToken(queue, 'emergency');
      const request = { ...data, id, token, type: 'emergency', status: 'pending', timestamp: new Date().toISOString() };
      if (data.existingId) queue.normal = queue.normal.filter(p => p.id !== data.existingId);
      queue.pendingEmergency.push(request);
      updateStats(queue);
      await saveQueue(queue);
      io.emit('queueUpdate', queue);
      socket.emit('emergencyRequested', request);
    });

    // Patient: cancel appointment
    socket.on('cancelAppointment', async (token) => {
      const cancelled = [...queue.normal, ...queue.emergency].find(p => p.token === token);
      queue.normal    = queue.normal.filter(p => p.token !== token);
      queue.emergency = queue.emergency.filter(p => p.token !== token);
      updateStats(queue);
      await saveQueue(queue);
      if (cancelled?.id) {
        const now = new Date();
        await Patient.findByIdAndUpdate(cancelled.id, { status: 'cancelled' });
        await User.findOneAndUpdate({ activePatientId: cancelled.id }, { activePatientId: null, queueStatus: 'CANCELLED' });
        // Update the Appointment record
        await Appointment.findOneAndUpdate(
          { patientId: cancelled.id, status: { $in: ['WAITING', 'SERVING'] } },
          { status: 'CANCELLED', cancelledAt: now },
          { sort: { createdAt: -1 } }
        );
      }
      io.emit('queueUpdate', queue);
    });

    // Staff: approve emergency
    socket.on('approveEmergency', async (token) => {
      const idx = queue.pendingEmergency.findIndex(p => p.token === token);
      if (idx !== -1) {
        const patient = queue.pendingEmergency.splice(idx, 1)[0];
        patient.status = 'waiting';
        patient.waitTime = '18 minutes';
        queue.emergency.push(patient);
        updateStats(queue);
        await saveQueue(queue);
        io.emit('queueUpdate', queue);
      }
    });

    // Staff: reject emergency
    socket.on('rejectEmergency', async (token) => {
      queue.pendingEmergency = queue.pendingEmergency.filter(p => p.token !== token);
      await saveQueue(queue);
      io.emit('queueUpdate', queue);
    });

    // Staff: register walk-in
    socket.on('registerWalkIn', async (data) => {
      const id = Math.random().toString(36).substr(2, 9);
      const isEmergency = data.priority === 'Emergency';
      const type = isEmergency ? 'emergency' : 'normal';
      const token = getNextToken(queue, type);
      const patient = { id, name: data.name, phone: data.phone, complaint: data.complaint, token, type, status: 'waiting', waitTime: isEmergency ? '5 minutes' : 'about 1 hour', timestamp: new Date().toISOString() };
      (isEmergency ? queue.emergency : queue.normal).push(patient);
      updateStats(queue);
      await saveQueue(queue);
      await Patient.findByIdAndUpdate(id, { _id: id, name: data.name, phone: data.phone, complaint: data.complaint, token, type }, { upsert: true });
      io.emit('queueUpdate', queue);
    });

    // Staff: escalate patient
    socket.on('escalatePatient', async (token) => {
      const idx = queue.normal.findIndex(p => p.token === token);
      if (idx !== -1) {
        const patient = queue.normal.splice(idx, 1)[0];
        patient.type = 'emergency';
        patient.token = getNextToken(queue, 'emergency');
        patient.waitTime = '5 minutes';
        queue.emergency.push(patient);
        updateStats(queue);
        await saveQueue(queue);
        io.emit('queueUpdate', queue);
      }
    });

    // Staff: remove patient
    socket.on('removePatient', async (token) => {
      queue.normal = queue.normal.filter(p => p.token !== token);
      queue.emergency = queue.emergency.filter(p => p.token !== token);
      updateStats(queue);
      await saveQueue(queue);
      io.emit('queueUpdate', queue);
    });

    // Doctor: call next — mark appointment as SERVING
    socket.on('callNext', async () => {
      if (queue.emergency.length > 0)      queue.serving = queue.emergency.shift();
      else if (queue.normal.length > 0)    queue.serving = queue.normal.shift();
      else                                  queue.serving = null;
      if (queue.serving) {
        const appt = await Appointment.findOneAndUpdate(
          { patientId: queue.serving.id, status: 'WAITING' },
          { status: 'SERVING', servedAt: new Date() },
          { sort: { createdAt: -1 }, new: true }
        );
        if (appt) {
          queue.serving.appointmentId  = String(appt._id);
          // Attach prescription count so frontend can derive button state on reload
          queue.serving.prescriptions  = appt.prescriptions || [];
        }
      }
      updateStats(queue);
      await saveQueue(queue);
      io.emit('queueUpdate', queue);
    });

    // Doctor: mark completed
    socket.on('markCompleted', async () => {
      if (queue.serving) {
        const completedId = queue.serving.id;
        const now = new Date();
        await Patient.findByIdAndUpdate(completedId, { status: 'completed' });
        await User.findOneAndUpdate({ activePatientId: completedId }, { activePatientId: null, queueStatus: 'COMPLETED' });
        await Appointment.findOneAndUpdate(
          { patientId: completedId, status: 'SERVING' },
          { status: 'COMPLETED', completedAt: now },
          { sort: { createdAt: -1 } }
        );
      }
      queue.serving = null;
      await saveQueue(queue);
      io.emit('queueUpdate', queue);
    });

    // Doctor: add prescription — also saved to Appointment
    socket.on('addPrescription', async ({ patientId, medication, dosage, frequency, duration, author }) => {
      if (!patientId) return;
      const entry = { medication, dosage, frequency, duration, author: author || { id: socket.id, name: 'Unknown' }, timestamp: new Date() };
      await Patient.findByIdAndUpdate(patientId, { $push: { prescriptions: entry } }, { upsert: true });
      await Appointment.findOneAndUpdate(
        { patientId, status: { $in: ['WAITING', 'SERVING'] } },
        { $push: { prescriptions: entry } },
        { sort: { createdAt: -1 } }
      );
      // Keep queue.serving in sync so button state updates without reload
      if (queue.serving?.id === patientId) {
        queue.serving.prescriptions = [...(queue.serving.prescriptions || []), entry];
        await saveQueue(queue);
      }
      const doc = await Patient.findById(patientId);
      const history = doc?.prescriptions || [];
      socket.emit('medicalHistory', { patientId, history });
      io.emit('medicalHistoryUpdate', { patientId, history });
      io.emit('queueUpdate', queue);
    });

    // Doctor/Patient: get medical history
    socket.on('getMedicalHistory', async (patientId) => {
      if (!patientId) return;
      const doc = await Patient.findById(patientId);
      socket.emit('medicalHistory', { patientId, history: doc?.prescriptions || [] });
    });

    // Doctor: set pending tests
    socket.on('setPendingTests', async ({ patientId, tests }) => {
      if (!patientId) return;
      ['normal', 'emergency'].forEach(list => {
        queue[list] = queue[list].map(p => p.id === patientId ? { ...p, status: 'Pending Tests', pendingTests: tests } : p);
      });
      if (queue.serving?.id === patientId) queue.serving.status = 'Pending Tests';
      await saveQueue(queue);
      await Patient.findByIdAndUpdate(patientId, { pendingTests: tests, status: 'Pending Tests' }, { upsert: true });
      io.emit('queueUpdate', queue);
      io.emit('testsUpdate', { patientId, tests });
    });

    // Doctor: request hard copy (logged to patient doc)
    socket.on('requestHardCopy', async ({ patientId, reason }) => {
      if (!patientId) return;
      io.emit('hardCopyRequested', { patientId, note: { requestedBy: socket.id, reason, timestamp: new Date().toISOString() } });
    });

    // OT rooms
    socket.on('getOTRooms', async () => {
      const rooms = await OTRoom.find();
      socket.emit('otUpdate', rooms.map(r => ({ id: r.roomId, status: r.status, patientId: r.patientId })));
    });

    socket.on('bookOT', async ({ roomId, patientId }) => {
      await OTRoom.findOneAndUpdate({ roomId }, { status: 'Occupied', patientId: patientId || null });
      const rooms = await OTRoom.find();
      io.emit('otUpdate', rooms.map(r => ({ id: r.roomId, status: r.status, patientId: r.patientId })));
    });

    socket.on('releaseOT', async ({ roomId }) => {
      await OTRoom.findOneAndUpdate({ roomId }, { status: 'Available', patientId: null });
      const rooms = await OTRoom.find();
      io.emit('otUpdate', rooms.map(r => ({ id: r.roomId, status: r.status, patientId: r.patientId })));
    });

    socket.on('scheduleSurgery', async ({ roomId, patientId }) => {
      await OTRoom.findOneAndUpdate({ roomId }, { status: 'Scheduled', patientId: patientId || null });
      const rooms = await OTRoom.find();
      io.emit('otUpdate', rooms.map(r => ({ id: r.roomId, status: r.status, patientId: r.patientId })));
    });

    socket.on('advanceOTState', async ({ roomId }) => {
      const seq = ['Scheduled', 'Pre-Op', 'In-Surgery', 'Recovery', 'Available'];
      const room = await OTRoom.findOne({ roomId });
      if (!room) return;
      const next = seq[Math.min(seq.length - 1, Math.max(0, seq.indexOf(room.status) + 1))];
      await OTRoom.findOneAndUpdate({ roomId }, { status: next, ...(next === 'Available' ? { patientId: null } : {}) });
      const rooms = await OTRoom.find();
      io.emit('otUpdate', rooms.map(r => ({ id: r.roomId, status: r.status, patientId: r.patientId })));
    });

    socket.on('disconnect', () => console.log('User disconnected:', socket.id));
  });

  // ── Vite / static ─────────────────────────────────────────────────────────────

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
  }

  // ── Listen ────────────────────────────────────────────────────────────────────

  const PORT = process.env.PORT || 3000;
  const tryListen = (port, remaining = 5) => {
    httpServer.listen(port, '0.0.0.0', () => console.log(`Server running on http://localhost:${port}`));
    httpServer.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && remaining > 0) {
        console.warn(`Port ${port} busy — trying ${port + 1}...`);
        try { httpServer.close(); } catch (_) {}
        tryListen(port + 1, remaining - 1);
      } else {
        console.error('Server failed to start:', err);
        process.exit(1);
      }
    });
  };
  tryListen(Number(PORT));
}

startServer();
