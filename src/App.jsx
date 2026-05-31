import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  User, 
  Users, 
  Stethoscope, 
  ArrowRight, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  LogOut, 
  ChevronLeft,
  Plus,
  Coffee,
  Check,
  X,
  Mic,
  ClipboardList
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const socket = io();

export default function App() {
  const [view, setView]           = useState('landing');
  const [viewHistory, setViewHistory] = useState([]);

  const navigateTo = (nextView) => {
    setViewHistory(prev => [...prev, view]);
    setView(nextView);
  };

  const navigateBack = (userRole) => {
    if (viewHistory.length > 0) {
      const prev = viewHistory[viewHistory.length - 1];
      setViewHistory(h => h.slice(0, -1));
      setView(prev);
    } else {
      // No history — fall back to role-based safe default
      const fallback =
        userRole === 'doctor' ? 'doctor-portal' :
        userRole === 'staff'  ? 'staff-portal'  :
        userRole === 'admin'  ? 'staff-portal'  :
        userRole === 'patient'? 'patient-portal' :
        'landing';
      setView(fallback);
    }
  };
  const [queue, setQueue] = useState({
    normal: [],
    emergency: [],
    pendingEmergency: [],
    serving: null,
    stats: { totalWaiting: 0, emergencies: 0, normalQueue: 0, avgWaitTime: "34m" }
  });
  const [user, setUser] = useState(null);
  const [myToken, setMyToken] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  // Medical history UI state
  const [historyModal, setHistoryModal]       = useState(false);
  const [historyEntries, setHistoryEntries]   = useState([]);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [historyPatient, setHistoryPatient]   = useState(null);
  const [historyPatientName, setHistoryPatientName] = useState(null);
  // Doctor notes state — lifted up so submitPrescription can include them
  const [doctorNotes,    setDoctorNotes]    = useState('');
  const [doctorTests,    setDoctorTests]    = useState([]);
  const [doctorFollowUp, setDoctorFollowUp] = useState(false);
  const [doctorFollowUpDays, setDoctorFollowUpDays] = useState(5);

  // Reset doctor notes when serving patient changes
  useEffect(() => {
    setDoctorNotes('');
    setDoctorTests([]);
    setDoctorFollowUp(false);
    setDoctorFollowUpDays(5);
  }, [queue.serving?.id]);

  // Doctor notes (speech-to-text) — handled inside DoctorNotes subcomponent
  

  // Tests checklist options (used by DoctorNotes subcomponent)

  // OT rooms and image viewer state
  const [otRooms, setOtRooms] = useState([]);
  const [imageModal, setImageModal] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [requestHardCopyState, setRequestHardCopyState] = useState(false);
  // Prescription modal state
  const [prescriptionModal, setPrescriptionModal]         = useState(false);
  const [prescriptionPatientId, setPrescriptionPatientId] = useState(null);
  const [prescriptionRows, setPrescriptionRows]           = useState([{ name: '', morning: false, afternoon: false, night: false }]);
  const [prescriptionSaving, setPrescriptionSaving]       = useState(false);
  const [prescriptionError, setPrescriptionError]         = useState('');
  // Per-appointment saved tracking — Set of appointmentIds that had prescriptions saved this session
  const [savedPrescriptionIds, setSavedPrescriptionIds]   = useState(new Set());
  // Follow-ups for patient — fetched from API, not localStorage
  const [followUps, setFollowUps]           = useState([]);
  const [followUpModal, setFollowUpModal]   = useState(false);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const notifiedFollowUpIdsRef = useRef(new Set());

  const openFollowUps = async () => {
    setFollowUpModal(true);
    if (!user?.userId) return;
    setFollowUpsLoading(true);
    try {
      const res  = await fetch(`/api/users/${user.userId}/followups`);
      const data = await res.json();
      if (res.ok) setFollowUps(data);
    } catch (_) {}
    finally { setFollowUpsLoading(false); }
  };
  // Break / quick action state
  const [breakActive, setBreakActive] = useState(false);
  const [breakRemaining, setBreakRemaining] = useState(0); // seconds
  const breakTimerRef = useRef(null);
  // Turn notification/banner state
  const [showTurnBanner, setShowTurnBanner] = useState(false);
  const turnNotifiedRef = useRef(false);

  useEffect(() => {
    socket.on('queueUpdate', (updatedQueue) => {
      setQueue(updatedQueue);
      // Sync myToken with the live queue — use both id and token for matching
      // to handle cases where id format differs (ObjectId vs short random string)
      setMyToken(prev => {
        if (!prev) return prev;
        const prevId    = prev.id    ? String(prev.id)    : null;
        const prevToken = prev.token ? String(prev.token) : null;

        const match = (p) =>
          (prevId    && String(p.id)    === prevId)    ||
          (prevToken && String(p.token) === prevToken);

        const inServing  = updatedQueue.serving && match(updatedQueue.serving) ? updatedQueue.serving : null;
        const inEmergency = updatedQueue.emergency.find(match);
        const inNormal    = updatedQueue.normal.find(match);
        const inPending   = updatedQueue.pendingEmergency.find(match);

        // If found anywhere in the queue, update with latest data
        if (inServing || inEmergency || inNormal || inPending) {
          return inServing || inEmergency || inNormal || inPending;
        }

        // Not found in queue — token was completed/cancelled by doctor or staff
        // Only clear if it was previously in a live state (not already null)
        return prev;
      });
    });

    socket.on('registrationSuccess', (patient) => {
      setMyToken(patient);
      setView('token-status');
    });

    socket.on('emergencyRequested', (patient) => {
      setMyToken(patient);
      setView('patient-portal');
    });

    // Medical history responses — now handled via REST, socket kept for legacy compatibility
    socket.on('medicalHistory', ({ patientId, history }) => {
      // no-op: history is now fetched via GET /api/patients/:id/history
    });

    // optional server-provided follow-ups (server may not emit this)
    socket.on('followUps', ({ patientId, followups }) => {
      if (!followups) return;
      setFollowUps(followups || []);
      try { localStorage.setItem('followUps', JSON.stringify(followups || [])); } catch(e){}
    });

    

    socket.on('medicalHistoryUpdate', ({ patientId, history }) => {
      // update visible history if matching
      if (historyPatient === patientId) {
        setHistoryEntries(history || []);
      }
    });

    socket.on('otUpdate', (rooms) => {
      setOtRooms(rooms || []);
    });

    socket.on('testsUpdate', ({ patientId, tests }) => {
      // nothing heavy: we could notify staff UI
      // For now we log and update serving patient if matching
      if (queue.serving && queue.serving.id === patientId) {
        setQueue(prev => ({ ...prev, serving: { ...prev.serving, pendingTests: tests, status: 'Pending Tests' } }));
      }
    });

    return () => {
      socket.off('queueUpdate');
      socket.off('registrationSuccess');
      socket.off('emergencyRequested');
      socket.off('medicalHistory');
      socket.off('medicalHistoryUpdate');
      socket.off('otUpdate');
      socket.off('testsUpdate');
    };
  }, []);

  // Follow-up date notifications (checks every minute)
  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      (followUps || []).forEach(f => {
        if (!f || !f._id || notifiedFollowUpIdsRef.current.has(f._id)) return;
        const d = new Date(f.followUpDate);
        if (isNaN(d)) return;
        if (d.toDateString() === now.toDateString()) {
          try {
            const title = 'MediCare — Follow-up Reminder';
            const body  = `You have a follow-up visit scheduled today (Token: ${f.tokenNumber}).`;
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(title, { body });
            } else if ('Notification' in window && Notification.permission !== 'denied') {
              Notification.requestPermission().then(p => { if (p === 'granted') new Notification(title, { body }); });
            }
          } catch (e) { console.error(e); }
          notifiedFollowUpIdsRef.current.add(f._id);
        }
      });
    }, 60 * 1000);
    return () => clearInterval(iv);
  }, [followUps]);

  // Break countdown logic
  useEffect(() => {
    // start interval when breakActive becomes true
    if (breakActive && breakRemaining > 0) {
      // clear existing interval if any
      if (breakTimerRef.current) clearInterval(breakTimerRef.current);
      breakTimerRef.current = setInterval(() => {
        setBreakRemaining(prev => {
          if (prev <= 1) {
            clearInterval(breakTimerRef.current);
            breakTimerRef.current = null;
            setBreakActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (breakTimerRef.current) {
        clearInterval(breakTimerRef.current);
        breakTimerRef.current = null;
      }
    };
  }, [breakActive]);

  const startBreak = (minutes) => {
    const seconds = Math.max(0, Math.floor(minutes) * 60);
    setBreakRemaining(seconds);
    setBreakActive(true);
  };

  const endBreak = () => {
    if (breakTimerRef.current) {
      clearInterval(breakTimerRef.current);
      breakTimerRef.current = null;
    }
    setBreakActive(false);
    setBreakRemaining(0);
  };

  // --- Handlers ---
  const handlePatientLogin = (data) => {
    // Always explicitly set myToken — null clears any stale token from a previous session
    setMyToken(data.activeToken || null);
    setUser({ name: data.name, role: data.role, userId: String(data.userId) });
    navigateTo('patient-portal');
  };

  const handleStaffLogin = (data) => {
    setUser({ name: data.name, role: data.role });
    navigateTo('staff-portal');
  };

  const handleDoctorLogin = (data) => {
    setUser({ name: data.name, role: data.role });
    navigateTo('doctor-portal');
  };

  const registerNormal = (formData) => {
    socket.emit('registerNormal', {
      userId:    user?.userId,
      name:      formData.name || user.name,
      phone:     formData.phone || user.phone,
      complaint: formData.complaint,
    });
  };

  const requestEmergency = (complaint) => {
    socket.emit('requestEmergency', { 
      name: user.name, 
      phone: user.phone, 
      complaint,
      existingId: myToken?.id 
    });
  };

  const requestMedicalHistory = async (patientId, patientName) => {
    setHistoryPatientName(patientName || user?.name || 'Patient');
    setHistoryEntries([]);
    setHistoryLoading(true);
    setHistoryModal(true);

    const resolvedUserId  = user?.userId;
    const resolvedPatient = patientId && String(patientId) !== String(resolvedUserId) ? patientId : null;

    if (!resolvedUserId && !resolvedPatient) {
      setHistoryLoading(false);
      return;
    }

    setHistoryPatient(resolvedPatient || resolvedUserId);
    try {
      const url = resolvedUserId
        ? `/api/users/${resolvedUserId}/appointments`
        : `/api/patients/${resolvedPatient}/history`;
      const res  = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load history');
      setHistoryEntries(data);
    } catch (err) {
      setHistoryEntries(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const addPrescription = (patientId) => {
    if (!patientId) return;
    setPrescriptionPatientId(patientId);
    setPrescriptionRows([{ name: '', morning: false, afternoon: false, night: false }]);
    setPrescriptionSaving(false);
    setPrescriptionError('');
    setPrescriptionModal(true);
  };

  const submitPrescription = async () => {
    const validRows = prescriptionRows.filter(r => r.name.trim());
    if (!validRows.length) { setPrescriptionError('Please add at least one medicine.'); return; }
    if (!prescriptionPatientId) { setPrescriptionError('No patient selected.'); return; }

    setPrescriptionSaving(true);
    setPrescriptionError('');

    const servingApptId = queue.serving?.appointmentId || null;

    try {
      if (servingApptId) {
        const res = await fetch(`/api/appointments/${servingApptId}/prescription`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            medicines:       validRows,
            doctorName:      user?.name || 'Doctor',
            socketId:        socket.id,
            doctorNotes:     doctorNotes.trim(),
            tests:           doctorTests,
            followUpRequired: doctorFollowUp,
            followUpInDays:  doctorFollowUp ? doctorFollowUpDays : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save prescription.');
      } else {
        // Fallback: socket emit for walk-in patients without appointmentId
        const medication = validRows.map(r => r.name.trim()).join(', ');
        const frequency  = validRows.map(r => {
          const times = [r.morning && 'Morning', r.afternoon && 'Afternoon', r.night && 'Night'].filter(Boolean);
          return `${r.name.trim()}: ${times.length ? times.join('+') : 'As directed'}`;
        }).join(' | ');
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Server did not respond.')), 8000);
          socket.once('medicalHistoryUpdate', () => { clearTimeout(timeout); resolve(); });
          socket.emit('addPrescription', {
            patientId:       prescriptionPatientId,
            medication,
            dosage:          JSON.stringify(validRows),
            frequency,
            duration:        'As prescribed',
            doctorNotes:     doctorNotes.trim(),
            tests:           doctorTests,
            followUpRequired: doctorFollowUp,
            followUpInDays:  doctorFollowUp ? doctorFollowUpDays : null,
            author:          { id: socket.id, name: user?.name || 'Dr' },
          });
        });
      }

      // Mark this specific appointment as having a prescription saved
      const savedApptId = servingApptId || prescriptionPatientId;
      if (savedApptId) {
        setSavedPrescriptionIds(prev => new Set([...prev, String(savedApptId)]));
      }
      setPrescriptionSaving(false);
      setTimeout(() => setPrescriptionModal(false), 1200);
    } catch (err) {
      setPrescriptionSaving(false);
      setPrescriptionError(err.message || 'Failed to save. Please try again.');
    }
  };



  const requestHardCopy = (patientId) => {
    if (!patientId) return;
    socket.emit('requestHardCopy', { patientId, reason: 'Requested from UI' });
    setRequestHardCopyState(true);
    setTimeout(()=>setRequestHardCopyState(false), 3000);
  };

  // Request OT rooms on mount when socket connects
  useEffect(()=>{
    socket.emit('getOTRooms');
  }, []);

  const logout = () => {
    setUser(null);
    setMyToken(null);          // always wipe token on logout — prevents ghost tokens
    setViewHistory([]);
    setView('landing');
  };

  // Patient: cancel their active appointment/token
  const cancelAppointment = (token) => {
    if (!token) return;
    if (!window.confirm('Are you sure you want to cancel your appointment?')) return;
    socket.emit('cancelAppointment', token);
    setMyToken(null);
    setViewHistory([]);
    navigateTo('patient-portal');
  };

  // Notify patient when it's their turn (single notification + top banner)
  useEffect(() => {
    if (!myToken || !queue || !queue.serving) return;
    try {
      if (queue.serving.id === myToken.id && !turnNotifiedRef.current) {
        turnNotifiedRef.current = true;
        setShowTurnBanner(true);
        const title = "MediCare — It's Your Turn";
        const body = `Your token ${myToken.token || ''} is being served now. Please proceed to the counter.`;
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
          Notification.requestPermission().then(p => { if (p === 'granted') new Notification(title, { body }); });
        } else {
          alert(`${title}\n${body}`);
        }
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) {
            const ctx = new AudioContext();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = 880;
            o.connect(g);
            g.connect(ctx.destination);
            o.start();
            g.gain.setValueAtTime(0.08, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.9);
            setTimeout(() => { try { o.stop(); ctx.close(); } catch(e){} }, 900);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }, [queue.serving, myToken]);

  // Reset notification flag when token cleared or changed
  useEffect(() => {
    if (!myToken) {
      turnNotifiedRef.current = false;
      setShowTurnBanner(false);
    }
  }, [myToken]);


  // --- Views ---

  const LandingPage = () => (
    <div className="min-h-screen bg-grid flex flex-col items-center justify-center p-6">
      <div className="absolute top-8 left-8 flex items-center gap-3">
        <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/20">
          <Plus className="text-white" />
        </div>
        <div>
          <h1 className="font-bold text-xl leading-none">MediCare</h1>
          <p className="text-[10px] text-white/40 uppercase tracking-widest">Hospital System</p>
        </div>
      </div>

      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-6">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          Live Queue Management Active
        </div>
        <h2 className="text-6xl font-bold tracking-tight mb-4">
          Smart Hospital <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">Queue Management</span>
        </h2>
        <p className="text-white/50 max-w-md mx-auto">
          Serving 500+ patients daily • 3 specialized portals • Real-time queue tracking
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl w-full">
        <PortalCard 
          icon={<User className="w-8 h-8" />}
          title="Patient Portal"
          description="Check your queue status, estimated wait time, and request emergency assistance."
          features={["Real-time queue tracking", "Voice-assisted registration", "Emergency priority requests"]}
          color="bg-primary"
          onClick={() => navigateTo('patient-login')}
        />
        <PortalCard 
          icon={<Users className="w-8 h-8" />}
          title="Staff Dashboard"
          description="Manage patient queues, handle emergency requests, and register walk-in patients."
          features={["Complete queue control", "Walk-in registration", "Emergency approval system"]}
          color="bg-secondary"
          onClick={() => navigateTo('staff-login')}
        />
        <PortalCard 
          icon={<Stethoscope className="w-8 h-8" />}
          title="Doctor Console"
          description="Call next patients, view medical complaints, and manage consultation breaks."
          features={["Automated patient calling", "Break time management", "Medical complaint preview"]}
          color="bg-accent"
          onClick={() => navigateTo('doctor-login')}
        />
      </div>
    </div>
  );

  const PatientLogin = () => {
    const [loginError, setLoginError] = useState('');
    const [email, setEmail]           = useState('');
    const [password, setPassword]     = useState('');
    const [voiceState, setVoiceState] = useState('idle'); // idle | listening | error
    const [voiceMsg, setVoiceMsg]     = useState('');
    const recRef                      = useRef(null);
    const emailRef                    = useRef(null);
    const passwordRef                 = useRef(null);

    const stopVoice = () => {
      if (recRef.current) { recRef.current.stop(); recRef.current = null; }
      setVoiceState('idle');
    };

    const toggleVoice = () => {
      if (voiceState === 'listening') { stopVoice(); return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { setVoiceMsg('Voice input not supported. Use Chrome.'); setVoiceState('error'); return; }
      const active = document.activeElement;
      const isEmail    = active === emailRef.current;
      const isPassword = active === passwordRef.current;
      if (!isEmail && !isPassword) { setVoiceMsg('Please click a field first.'); setVoiceState('error'); return; }
      setVoiceMsg(''); setVoiceState('listening');
      const rec = new SR();
      rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const t = e.results[0][0].transcript.trim();
        if (!t) return;
        if (isEmail)    setEmail(prev    => prev + t);
        if (isPassword) setPassword(prev => prev + t);
      };
      rec.onerror = (e) => {
        recRef.current = null; setVoiceState('error');
        setVoiceMsg(e.error === 'not-allowed' ? 'Microphone access denied.' : e.error === 'no-speech' ? 'No speech detected.' : 'Voice error. Try again.');
      };
      rec.onend = () => { recRef.current = null; setVoiceState(prev => prev === 'listening' ? 'idle' : prev); };
      recRef.current = rec; rec.start();
    };

    useEffect(() => () => { if (recRef.current) recRef.current.stop(); }, []);

    const handleSubmit = async (e) => {
      e.preventDefault(); stopVoice(); setLoginError('');
      try {
        const res  = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const data = await res.json();
        if (!res.ok) { setLoginError(data.error || 'Login failed.'); return; }
        handlePatientLogin(data);
      } catch { setLoginError('Network error. Please try again.'); }
    };

    const isListening = voiceState === 'listening';

    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card max-w-md w-full p-10 text-center">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/20">
            <Plus className="text-white w-8 h-8" />
          </div>
          <h2 className="text-3xl font-bold mb-2">Patient Login</h2>
          <p className="text-white/40 text-sm mb-8">Enter your details to access your health portal</p>

          <form onSubmit={handleSubmit} className="space-y-4 text-left">
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">Email</label>
              <input ref={emailRef} type="email" placeholder="you@example.com" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">Password</label>
              <input ref={passwordRef} type="password" placeholder="Enter password" required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary transition-colors" />
            </div>
            {loginError && <p className="text-red-400 text-xs">{loginError}</p>}
            {voiceState === 'error' && voiceMsg && <p className="text-red-400 text-xs">{voiceMsg}</p>}
            {isListening && (
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Listening...</span>
              </div>
            )}
            <div className="flex gap-3">
              <button type="submit" className="flex-1 bg-gradient-to-r from-primary to-secondary text-white font-bold py-4 rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.02] transition-transform">
                Login to Portal
              </button>
              <button type="button" onClick={toggleVoice}
                className={`w-14 rounded-xl flex items-center justify-center transition-all ${
                  isListening ? 'bg-red-500 animate-pulse shadow-lg shadow-red-500/30' : 'bg-white/10 hover:bg-white/20'
                }`}>
                <Mic className="w-5 h-5 text-white" />
              </button>
            </div>
          </form>

          <p className="mt-6 text-white/40 text-sm">
            New user?{' '}
            <button onClick={() => navigateTo('signup')} className="text-primary font-semibold hover:underline">Sign up</button>
          </p>
          <div className="absolute top-6 left-6">
            <BackButton onBack={() => navigateBack(user?.role)} dark={false} />
          </div>
        </motion.div>
      </div>
    );
  };

  const PatientPortal = () => {
    const isRegistered = !!myToken;
    const activeToken = myToken;
    const [showEmergencyModal, setShowEmergencyModal] = useState(false);
    const isEmergency = activeToken?.type === 'emergency' || activeToken?.status === 'pending';

    return (
      <div className="min-h-screen bg-white text-slate-900">
        {showTurnBanner && (
          <div className="fixed top-0 left-0 right-0 bg-amber-400 text-black text-center py-2 z-50">
            <div className="max-w-3xl mx-auto flex items-center justify-between px-4">
              <div className="font-bold">It's your turn — please proceed to the counter now.</div>
              <button onClick={() => setShowTurnBanner(false)} className="ml-4 bg-black/5 px-3 py-1 rounded">Dismiss</button>
            </div>
          </div>
        )}
        <header className="border-b border-slate-100 px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton onBack={() => navigateBack(user?.role)} />
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/20">
              <Plus className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-none">MediCare</h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Hospital System</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-50 border border-slate-100">
              <User className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">{user?.name}</span>
            </div>
            <button onClick={logout} className="flex items-center gap-2 px-4 py-2 rounded-full border border-emergency/20 text-emergency text-sm font-semibold hover:bg-emergency/5 transition-colors">
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </header>

        <main className="max-w-3xl mx-auto py-12 px-6">
          <div className="mb-12">
            <h2 className="text-3xl font-bold flex items-center gap-3">
              <span className="text-4xl">👋</span> Hello, <span className="text-primary">{user?.name}</span>
            </h2>
            <p className="text-slate-400 mt-2">Welcome to MediCare Patient Portal. What would you like to do?</p>
          </div>

          <div className="space-y-6">
            {isRegistered && (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`p-6 rounded-3xl border flex items-center justify-between ${activeToken.status === 'pending' ? 'bg-amber-50 border-amber-100' : (activeToken.type === 'emergency' ? 'bg-emergency/5 border-emergency/10' : 'bg-primary/5 border-primary/10')}`}
              >
                <div className="flex items-center gap-6">
                  <div className={`w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-2xl font-bold ${activeToken.status === 'pending' ? 'text-amber-500' : (activeToken.type === 'emergency' ? 'text-emergency' : 'text-primary')}`}>
                    {activeToken.token.charAt(0)}
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Your Active Token</p>
                    <h3 className="text-3xl font-bold">{activeToken.token}</h3>
                  </div>
                </div>
                <div className={`px-4 py-1.5 text-white text-[10px] font-black uppercase tracking-widest rounded-lg ${activeToken.status === 'pending' ? 'bg-amber-500' : (activeToken.type === 'emergency' ? 'bg-emergency' : 'bg-primary')}`}>
                  {activeToken.status === 'pending' ? 'Pending Approval' : (activeToken.type === 'emergency' ? 'Emergency' : 'Normal Queue')}
                </div>
              </motion.div>
            )}

            <PortalAction 
              icon={<Clock className="w-6 h-6" />}
              title="Register in Queue"
              description="Join the normal queue and get your token number assigned."
              disabled={isRegistered}
              status={isRegistered ? "Already registered" : null}
              color="bg-primary"
              onClick={() => navigateTo('patient-registration')}
            />

            <PortalAction 
              icon={<Users className="w-6 h-6" />}
              title="Check Token Status"
              description="View your token number, estimated wait time, and queue position."
              disabled={!isRegistered}
              status={!isRegistered ? "No active token" : null}
              color="bg-secondary"
              onClick={() => navigateTo('token-status')}
              showArrow
            />

            <PortalAction 
              icon={<AlertCircle className="w-6 h-6" />}
              title="Emergency Registration"
              description="Skip the queue for critical conditions. Requires staff approval."
              disabled={!isRegistered || isEmergency}
              status={!isRegistered ? "Register first" : (isEmergency ? "Emergency active/pending" : null)}
              color="bg-emergency"
              onClick={() => setShowEmergencyModal(true)}
            />

            <PortalAction 
              icon={<ClipboardList className="w-6 h-6" />}
              title="Medical History"
              description="View past prescriptions and medical records."
              color="bg-accent"
              onClick={() => requestMedicalHistory(myToken?.id || user?.userId, user?.name)}
            />

            <PortalAction
              icon={<ClipboardList className="w-6 h-6" />}
              title="Follow-ups"
              description="View follow-up appointments scheduled by your doctor."
              color="bg-primary"
              onClick={openFollowUps}
            />

            
          </div>
        </main>

        {showEmergencyModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
              <h3 className="text-2xl font-bold mb-4">Emergency Request</h3>
              <p className="text-slate-500 mb-6">Please describe your condition briefly for the staff to review.</p>
              <textarea 
                id="complaint"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 mb-6 focus:outline-none focus:border-emergency"
                placeholder="e.g. Severe chest pain, deep laceration..."
                rows={3}
              />
              <div className="flex gap-4">
                <button onClick={() => setShowEmergencyModal(false)} className="flex-1 py-4 rounded-xl font-bold text-slate-400 hover:bg-slate-50 transition-colors">Cancel</button>
                <button 
                  onClick={() => {
                    requestEmergency(document.getElementById('complaint').value);
                    setShowEmergencyModal(false);
                  }}
                  className="flex-1 bg-emergency text-white py-4 rounded-xl font-bold shadow-lg shadow-emergency/20"
                >
                  Request
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {historyModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xl font-bold">Medical History</h3>
                <button onClick={() => setHistoryModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {/* Loading */}
                {historyLoading && (
                  <div className="py-10 flex flex-col items-center gap-3">
                    <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    <p className="text-sm text-slate-400">Loading records...</p>
                  </div>
                )}

                {/* Error */}
                {!historyLoading && historyEntries === null && (
                  <div className="py-10 text-center">
                    <p className="text-red-400 text-sm font-medium">Failed to load history.</p>
                    <button
                      onClick={() => requestMedicalHistory(myToken?.id || user?.userId, user?.name)}
                      className="mt-3 text-xs text-primary font-semibold hover:underline"
                    >Try again</button>
                  </div>
                )}

                {/* Empty state */}
                {!historyLoading && Array.isArray(historyEntries) && historyEntries.length === 0 && (
                  <div className="py-12 flex flex-col items-center gap-3 text-center">
                    <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center">
                      <ClipboardList className="w-7 h-7 text-slate-300" />
                    </div>
                    <p className="font-semibold text-slate-500">No records yet</p>
                    <p className="text-xs text-slate-400 max-w-xs">Your appointment history and prescriptions will appear here after your first visit.</p>
                  </div>
                )}

                {/* Appointment cards */}
                {!historyLoading && Array.isArray(historyEntries) && historyEntries.map((appt, idx) => {
                  // Support both Appointment model (has tokenNumber/status) and legacy history format
                  const isAppointment = !!appt.tokenNumber;
                  const statusColor = {
                    COMPLETED: 'bg-emerald-100 text-emerald-700',
                    CANCELLED: 'bg-red-100 text-red-600',
                    WAITING:   'bg-amber-100 text-amber-700',
                    SERVING:   'bg-blue-100 text-blue-700',
                  }[appt.status] || 'bg-slate-100 text-slate-500';

                  const prescriptions = appt.prescriptions || [];

                  return (
                    <div key={appt._id || idx} className="border border-slate-100 rounded-2xl overflow-hidden">
                      {/* Appointment header */}
                      <div className="bg-slate-50 px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 bg-primary rounded-full" />
                          <div>
                            <span className="text-sm font-bold text-slate-700">
                              {new Date(appt.createdAt || appt.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </span>
                            {isAppointment && (
                              <span className="ml-2 text-xs font-bold text-primary">{appt.tokenNumber}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {appt.complaint && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-white border border-slate-100 px-2 py-1 rounded-lg">
                              {appt.complaint}
                            </span>
                          )}
                          {isAppointment && (
                            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg ${statusColor}`}>
                              {appt.status}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Timestamps */}
                      {isAppointment && (appt.completedAt || appt.cancelledAt) && (
                        <div className="px-4 pt-2 text-[11px] text-slate-400">
                          {appt.completedAt && `Completed: ${new Date(appt.completedAt).toLocaleString()}`}
                          {appt.cancelledAt && `Cancelled: ${new Date(appt.cancelledAt).toLocaleString()}`}
                        </div>
                      )}

                      {/* Doctor Notes */}
                      {appt.doctorNotes && (
                        <div className="px-4 pt-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Doctor Notes</p>
                          <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">{appt.doctorNotes}</p>
                        </div>
                      )}

                      {/* Tests */}
                      {appt.tests?.length > 0 && (
                        <div className="px-4 pt-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Tests Ordered</p>
                          <div className="flex flex-wrap gap-1.5">
                            {appt.tests.map(t => (
                              <span key={t} className="px-2 py-1 bg-primary/10 text-primary text-[10px] font-bold rounded-lg">{t}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Follow-up */}
                      {appt.followUpDate && (
                        <div className="px-4 pt-3 pb-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Follow-up</p>
                          <p className="text-sm font-semibold text-accent">
                            {new Date(appt.followUpDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      )}

                      {/* Prescriptions */}
                      {prescriptions.length > 0 ? (
                        <div className="divide-y divide-slate-50">
                          {prescriptions.map((rx, rIdx) => {
                            let structured = null;
                            try { structured = JSON.parse(rx.dosage); } catch (_) {}
                            return (
                              <div key={rIdx} className="px-4 py-3">
                                <div className="flex items-start justify-between mb-2">
                                  <span className="font-semibold text-sm text-slate-800">{rx.medication}</span>
                                  <span className="text-[10px] text-slate-400">{rx.author?.name || rx.author}</span>
                                </div>
                                {Array.isArray(structured) ? (
                                  <div className="space-y-1.5">
                                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 px-1">
                                      <span>Medicine</span><span>Morn</span><span>Aftn</span><span>Night</span>
                                    </div>
                                    {structured.map((m, mIdx) => (
                                      <div key={mIdx} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center bg-slate-50 rounded-lg px-3 py-2">
                                        <span className="text-xs font-medium text-slate-700">{m.name}</span>
                                        {['morning', 'afternoon', 'night'].map(slot => (
                                          <span key={slot} className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                            m[slot] ? 'bg-primary text-white' : 'bg-slate-200 text-slate-400'
                                          }`}>{m[slot] ? '✓' : '–'}</span>
                                        ))}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs text-slate-500 space-y-0.5">
                                    {rx.frequency && <p>{rx.frequency}</p>}
                                    {rx.duration  && <p className="text-slate-400">{rx.duration}</p>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="px-4 py-3 text-xs text-slate-400 italic">No prescription for this visit.</div>
                      )}
                    </div>
                  );
                })}

                {!historyLoading && Array.isArray(historyEntries) && historyEntries.length === 0 && historyPatient && (
                  <div className="py-6 text-center text-slate-400 text-sm">No previous appointments found.</div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {followUpModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xl font-bold">Follow-up Appointments</h3>
                <button onClick={() => setFollowUpModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                {/* Loading */}
                {followUpsLoading && (
                  <div className="py-10 flex flex-col items-center gap-3">
                    <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    <p className="text-sm text-slate-400">Loading follow-ups...</p>
                  </div>
                )}

                {/* Empty state */}
                {!followUpsLoading && followUps.length === 0 && (
                  <div className="py-12 flex flex-col items-center gap-3 text-center">
                    <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center">
                      <Clock className="w-7 h-7 text-slate-300" />
                    </div>
                    <p className="font-semibold text-slate-500">No follow-ups scheduled</p>
                    <p className="text-xs text-slate-400">Your doctor will schedule follow-up appointments here after your consultation.</p>
                  </div>
                )}

                {/* Follow-up cards */}
                {!followUpsLoading && followUps.map((appt) => (
                  <div key={appt._id} className="border border-primary/20 rounded-2xl overflow-hidden">
                    {/* Header */}
                    <div className="bg-primary/5 px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-primary rounded-full" />
                        <span className="text-sm font-bold text-slate-700">
                          {new Date(appt.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                        <span className="text-xs font-bold text-primary ml-1">{appt.tokenNumber}</span>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700">
                        Follow-up
                      </span>
                    </div>

                    {/* Follow-up details */}
                    <div className="px-4 py-4 space-y-3">
                      {appt.complaint && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Complaint</p>
                          <p className="text-sm text-slate-700">{appt.complaint}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-slate-50 rounded-xl p-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Appointment Date</p>
                          <p className="text-sm font-semibold text-slate-700">
                            {new Date(appt.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Follow-up After</p>
                          <p className="text-sm font-semibold text-slate-700">{appt.followUpInDays} days</p>
                        </div>
                        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">Next Visit</p>
                          <p className="text-sm font-bold text-primary">
                            {new Date(appt.followUpDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}

        

        {imageModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-6 max-w-4xl w-full shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">Image Viewer / Annotations</h3>
                <div className="flex items-center gap-2">
                  <input placeholder="Image URL (jpg/png)" value={imageUrl} onChange={(e)=>setImageUrl(e.target.value)} className="px-3 py-2 border rounded" />
                  <button onClick={()=>setImageUrl(imageUrl)} className="px-3 py-2 bg-secondary text-white rounded">Load</button>
                  <button onClick={()=>setImageModal(false)} className="px-3 py-2 rounded border">Close</button>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 bg-slate-50 rounded p-4 flex items-center justify-center">
                  {imageUrl ? (
                    <div className="relative">
                      <img src={imageUrl} alt="img" className="max-h-[60vh] object-contain" />
                      <div className="absolute inset-0 pointer-events-none" />
                    </div>
                  ) : (
                    <div className="text-slate-400">Enter an image URL to preview (supports hosted JPEG/PNG).</div>
                  )}
                </div>
                <div className="w-72 p-4 border rounded">
                  <div className="mb-3 font-semibold">Tools</div>
                  <div className="space-y-2">
                    <button className="w-full px-3 py-2 rounded bg-slate-50">Zoom In</button>
                    <button className="w-full px-3 py-2 rounded bg-slate-50">Zoom Out</button>
                    <button className="w-full px-3 py-2 rounded bg-slate-50">Annotate (freehand)</button>
                    <button className="w-full px-3 py-2 rounded bg-slate-50">Clear Annotations</button>
                    <div className="mt-4">
                      <label className="text-sm">Request Hard Copy (for patient)</label>
                      <div className="mt-2">
                        <button onClick={()=>requestHardCopy(queue.serving?.id)} className="w-full px-3 py-2 rounded bg-secondary text-white">Request Hard Copy</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    );
  };

  const StaffPortal = () => {
    const [showWalkInModal, setShowWalkInModal] = useState(false);

    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton onBack={() => navigateBack(user?.role)} />
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/20">
              <Plus className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-none">MediCare</h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Hospital System</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-50 border border-slate-100">
              <Users className="w-4 h-4 text-secondary" />
              <span className="text-sm font-semibold">Staff Admin</span>
            </div>
            <button onClick={logout} className="flex items-center gap-2 px-4 py-2 rounded-full border border-emergency/20 text-emergency text-sm font-semibold hover:bg-emergency/5 transition-colors">
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </header>

        <main className="max-w-7xl mx-auto py-10 px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
            <StatCard icon={<Users />} label="Total Waiting" value={queue.stats.totalWaiting} color="text-primary" />
            <StatCard icon={<AlertCircle />} label="Emergencies" value={queue.stats.emergencies} color="text-emergency" />
            <StatCard icon={<User />} label="Normal Queue" value={queue.stats.normalQueue} color="text-secondary" />
            <StatCard icon={<Clock />} label="Avg Wait Time" value={queue.stats.avgWaitTime} color="text-amber-500" />
          </div>

          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold">Queue Management</h2>
            <button 
              onClick={() => setShowWalkInModal(true)}
              className="bg-secondary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-secondary/20"
            >
              <Plus className="w-5 h-5" />
              Register Walk-in
            </button>
          </div>

          {queue.pendingEmergency.length > 0 && (
            <div className="mb-10">
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-4 flex items-center gap-3 text-amber-800 font-bold text-sm">
                <AlertCircle className="w-5 h-5" />
                ATTENTION: {queue.pendingEmergency.length} Pending Emergency Request(s)
              </div>
              <div className="space-y-4">
                {queue.pendingEmergency.map(p => (
                  <div key={p.token} className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-6">
                      <span className="font-bold text-lg">{p.token}</span>
                      <span className="text-slate-400">{p.name}</span>
                      <div className="px-3 py-1 bg-slate-100 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-600">
                        Condition: {p.complaint || "Not specified"}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => socket.emit('approveEmergency', p.token)}
                        className="bg-secondary text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2"
                      >
                        <Check className="w-4 h-4" /> Approve
                      </button>
                      <button 
                        onClick={() => socket.emit('rejectEmergency', p.token)}
                        className="border border-slate-200 text-slate-400 px-6 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50"
                      >
                        <X className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <QueueSection 
              title="Emergency Queue" 
              count={queue.emergency.length} 
              patients={queue.emergency} 
              color="emergency" 
              onRemove={(token) => socket.emit('removePatient', token)}
            />
            <QueueSection 
              title="Normal Queue" 
              count={queue.normal.length} 
              patients={queue.normal} 
              color="secondary" 
              showEscalate
              onEscalate={(token) => socket.emit('escalatePatient', token)}
              onRemove={(token) => socket.emit('removePatient', token)}
            />
          </div>

          <div className="mt-10">
            <h3 className="text-xl font-bold mb-4">Operating Theaters (OT) — Live</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {otRooms.map(r => {
                const isAvailable = ((r.status || '').toString().toLowerCase() === 'available');
                return (
                  <div key={r.id} className="p-4 rounded-2xl border bg-white">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-bold">{r.id}</div>
                      <div className={`text-sm px-2 py-1 rounded ${isAvailable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {r.status || (isAvailable ? 'Available' : 'Occupied')}
                      </div>
                    </div>
                    <div className="text-sm text-slate-600 mb-3">Patient: {r.patientId || '—'}</div>
                    <div className="flex gap-2">
                      {isAvailable ? (
                        <button
                          onClick={() => {
                            const patientId = queue.normal[0]?.id || null;
                            socket.emit('bookOT', { roomId: r.id, patientId });
                            setOtRooms(prev => prev.map(x => x.id === r.id ? { ...x, status: 'Occupied', patientId } : x));
                          }}
                          className="px-3 py-2 rounded bg-emerald-600 text-white"
                        >
                          Book
                        </button>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              socket.emit('releaseOT', { roomId: r.id });
                              setOtRooms(prev => prev.map(x => x.id === r.id ? { ...x, status: 'Available', patientId: null } : x));
                            }}
                            className="px-3 py-2 rounded bg-red-600 text-white"
                          >
                            Make Available
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>

        {showWalkInModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
              <h3 className="text-2xl font-bold mb-6">Register Walk-in Patient</h3>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                socket.emit('registerWalkIn', {
                  name: formData.get('name'),
                  phone: formData.get('phone'),
                  complaint: formData.get('complaint'),
                  priority: formData.get('priority')
                });
                setShowWalkInModal(false);
              }}>
                <div className="space-y-4 mb-8">
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Name</label>
                    <input name="name" type="text" required className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 focus:outline-none focus:border-secondary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Phone</label>
                    <input name="phone" type="text" required className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 focus:outline-none focus:border-secondary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Complaint</label>
                    <input name="complaint" type="text" className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 focus:outline-none focus:border-secondary" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Priority</label>
                    <select name="priority" className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 focus:outline-none focus:border-secondary appearance-none">
                      <option value="Normal">Normal</option>
                      <option value="Emergency">Emergency</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button type="button" onClick={() => setShowWalkInModal(false)} className="flex-1 py-4 rounded-xl font-bold text-slate-400 hover:bg-slate-50 transition-colors">Cancel</button>
                  <button 
                    type="submit"
                    className="flex-1 bg-gradient-to-r from-secondary to-primary text-white py-4 rounded-xl font-bold shadow-lg shadow-secondary/20"
                  >
                    Register
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </div>
    );
  };

  const DoctorPortal = () => {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton onBack={() => navigateBack(user?.role)} />
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/20">
              <Plus className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-none">MediCare</h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Hospital System</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-accent/5 border border-accent/10">
              <Stethoscope className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold">{user?.name || 'Doctor'}</span>
            </div>
            <button onClick={logout} className="flex items-center gap-2 px-4 py-2 rounded-full border border-emergency/20 text-emergency text-sm font-semibold hover:bg-emergency/5 transition-colors">
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </header>

        {breakActive && (
          <div className="bg-amber-50 border-b border-amber-100 px-8 py-3 text-amber-800 font-semibold flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Coffee className="w-5 h-5" />
              On Break — {Math.floor(breakRemaining / 60)}:{(breakRemaining % 60).toString().padStart(2, '0')}
            </div>
            <div>
              <button onClick={endBreak} className="px-3 py-1 rounded-md bg-red-50 border border-red-100 text-red-600 font-bold">End Break</button>
            </div>
          </div>
        )}

        <main className="max-w-7xl mx-auto py-10 px-8 grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2 space-y-8">
            <div className="mb-2">
              <h2 className="text-2xl font-bold">
                Hello, <span className="text-accent">{user?.name ? `Dr. ${user.name}` : 'Doctor'}</span> 👋
              </h2>
            </div>
            <div className="bg-white rounded-[40px] p-12 shadow-xl shadow-slate-200/50 border border-slate-100 relative overflow-hidden">
              <div className="flex items-center gap-3 text-primary font-bold mb-12">
                <User className="w-5 h-5" />
                Current Patient
              </div>

              {queue.serving ? (
                <>
                <div className="text-center">
                  <div className="absolute top-12 right-12 px-4 py-1.5 bg-emergency text-white text-[10px] font-black uppercase tracking-widest rounded-lg">
                    {queue.serving.type}
                  </div>
                  <h2 className="text-[120px] font-black leading-none mb-4 tracking-tighter text-slate-900">{queue.serving.token}</h2>
                  <p className="text-4xl font-bold text-slate-400 mb-12">{queue.serving.name}</p>
                  
                    <div className="max-w-xs mx-auto bg-slate-50 rounded-3xl p-6 border border-slate-100">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Complaint</p>
                    <p className="text-lg font-bold">{queue.serving.complaint || "General Checkup"}</p>
                    <div className="mt-4 flex justify-center gap-3">
                      {(() => {
                        // Prescription is saved if:
                        // 1. We saved it this session (savedPrescriptionIds), OR
                        // 2. The appointment already has prescriptions in DB (queue.serving.prescriptions)
                        const apptId = queue.serving.appointmentId;
                        const hasPrescription =
                          (apptId && savedPrescriptionIds.has(String(apptId))) ||
                          (queue.serving.prescriptions?.length > 0);
                        return (
                          <button
                            type="button"
                            onClick={() => !hasPrescription && addPrescription(queue.serving.id)}
                            disabled={hasPrescription}
                            className={`px-4 py-2 rounded-xl font-bold transition-all ${
                              hasPrescription
                                ? 'bg-emerald-100 text-emerald-700 cursor-default'
                                : 'bg-secondary text-white hover:bg-secondary/90'
                            }`}
                          >
                            {hasPrescription ? '✓ Prescription Added' : 'Add Prescription'}
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => requestMedicalHistory(queue.serving?.id, queue.serving?.name)}
                        className="px-4 py-2 border rounded-xl font-bold text-primary"
                      >
                        History
                      </button>
                    </div>
                  </div>
                </div>

              <div className="mt-8">
                <DoctorNotes
                  patientId={queue.serving?.id}
                  socket={socket}
                  requestHardCopy={requestHardCopy}
                  requestHardCopyState={requestHardCopyState}
                  setImageModal={setImageModal}
                  setImageUrl={setImageUrl}
                  notes={doctorNotes}
                  setNotes={setDoctorNotes}
                  selectedTests={doctorTests}
                  setSelectedTests={setDoctorTests}
                  followUp={doctorFollowUp}
                  setFollowUp={setDoctorFollowUp}
                  followUpDays={doctorFollowUpDays}
                  setFollowUpDays={setDoctorFollowUpDays}
                />
              </div>
                </>
              ) : (
                <div className="py-20 text-center text-slate-300">
                  <Users className="w-20 h-20 mx-auto mb-4 opacity-20" />
                  <p className="text-xl font-medium">No patient currently being served</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <button 
                onClick={() => socket.emit('markCompleted')}
                disabled={!queue.serving}
                className={`py-6 rounded-3xl font-bold text-xl flex items-center justify-center gap-3 shadow-xl transition-all ${!queue.serving ? 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none' : 'bg-secondary text-white shadow-secondary/20 hover:scale-[1.02]'}`}
              >
                <CheckCircle2 className="w-6 h-6" /> Mark Completed
              </button>
              <button 
                onClick={() => socket.emit('callNext')}
                disabled={!!queue.serving || (queue.normal.length === 0 && queue.emergency.length === 0)}
                className={`py-6 rounded-3xl font-bold text-xl flex items-center justify-center gap-3 shadow-xl transition-all ${!!queue.serving || (queue.normal.length === 0 && queue.emergency.length === 0) ? 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none' : 'bg-primary text-white shadow-primary/20 hover:scale-[1.02]'}`}
              >
                Call Next Patient <ArrowRight className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="space-y-8">
            <div className="bg-white rounded-[32px] p-8 shadow-lg shadow-slate-200/50 border border-slate-100">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold">Up Next</h3>
                <span className="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {queue.normal.length + queue.emergency.length} waiting
                </span>
              </div>
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {[...queue.emergency, ...queue.normal].map((p, i) => (
                  <div key={p.token} className="p-4 rounded-2xl border border-slate-100 flex items-center justify-between group hover:border-primary/30 transition-colors">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`font-bold ${p.type === 'emergency' ? 'text-emergency' : 'text-primary'}`}>{p.token}</span>
                        <span className="font-bold text-slate-700">{p.name}</span>
                        {i === 0 && <span className="px-2 py-0.5 bg-primary/10 text-primary text-[8px] font-black uppercase tracking-widest rounded">Next</span>}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <Clock className="w-3 h-3" />
                        <span>Waiting {p.waitTime || '15 mins'}</span>
                      </div>
                    </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => requestMedicalHistory(p.id, p.name)} className="text-sm text-primary font-bold">History</button>
                      </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-[32px] p-8 shadow-lg shadow-slate-200/50 border border-slate-100">
              <h3 className="text-xl font-bold mb-6">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-4">
                {!breakActive ? (
                  <>
                    <button onClick={() => startBreak(5)} className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-slate-100 transition-colors">
                      <Coffee className="w-6 h-6 text-slate-400" />
                      <span className="text-xs font-bold text-slate-600">5 Min Break</span>
                    </button>
                    <button onClick={() => startBreak(15)} className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-slate-100 transition-colors">
                      <Coffee className="w-6 h-6 text-slate-400" />
                      <span className="text-xs font-bold text-slate-600">15 Min Break</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col items-center justify-center gap-2 p-6 rounded-2xl bg-emerald-50 border border-emerald-100">
                      <div className="text-sm font-bold text-emerald-700">On Break</div>
                      <div className="text-xs text-emerald-600">
                        {Math.floor(breakRemaining / 60).toString().padStart(1, '0')}:{(breakRemaining % 60).toString().padStart(2, '0')}
                      </div>
                    </div>
                    <button onClick={endBreak} className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl bg-red-50 border border-red-100 hover:bg-red-100 transition-colors">
                      <X className="w-6 h-6 text-red-500" />
                      <span className="text-xs font-bold text-red-600">End Break</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* ── Prescription Modal ── */}
        {prescriptionModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Add Prescription</h3>
                {!prescriptionSaving && (
                  <button onClick={() => setPrescriptionModal(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Success state — shown briefly before modal closes */}
              {savedPrescriptionIds.has(String(queue.serving?.appointmentId || prescriptionPatientId)) ? (
                <div className="py-10 flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <p className="text-lg font-bold text-emerald-700">Prescription Saved!</p>
                  <p className="text-sm text-slate-400">Linked to patient record and appointment.</p>
                </div>
              ) : (
                <>
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 mb-2 px-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Medicine</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Morning</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Afternoon</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Night</span>
                    <span className="w-6" />
                  </div>

                  <div className="space-y-3 max-h-64 overflow-y-auto mb-5">
                    {prescriptionRows.map((row, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center">
                        <input
                          type="text"
                          placeholder="e.g. Paracetamol"
                          value={row.name}
                          onChange={e => setPrescriptionRows(prev => prev.map((r, i) => i === idx ? { ...r, name: e.target.value } : r))}
                          className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary font-medium"
                          disabled={prescriptionSaving}
                        />
                        {['morning', 'afternoon', 'night'].map(slot => (
                          <label key={slot} className="flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={row[slot]}
                              onChange={() => setPrescriptionRows(prev => prev.map((r, i) => i === idx ? { ...r, [slot]: !r[slot] } : r))}
                              className="w-4 h-4 accent-primary cursor-pointer"
                              disabled={prescriptionSaving}
                            />
                          </label>
                        ))}
                        <button
                          onClick={() => setPrescriptionRows(prev => prev.filter((_, i) => i !== idx))}
                          disabled={prescriptionRows.length === 1 || prescriptionSaving}
                          className="text-slate-300 hover:text-red-400 transition-colors disabled:opacity-30"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setPrescriptionRows(prev => [...prev, { name: '', morning: false, afternoon: false, night: false }])}
                    disabled={prescriptionSaving}
                    className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 transition-colors mb-4 disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4" /> Add Medicine
                  </button>

                  {/* Error message */}
                  {prescriptionError && (
                    <p className="text-red-500 text-xs font-medium mb-4">{prescriptionError}</p>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => setPrescriptionModal(false)}
                      disabled={prescriptionSaving}
                      className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-50 transition-colors border border-slate-100 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitPrescription}
                      disabled={prescriptionSaving || !prescriptionRows.some(r => r.name.trim())}
                      className="flex-1 py-3 rounded-xl font-bold bg-secondary text-white shadow-lg shadow-secondary/20 hover:scale-[1.02] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {prescriptionSaving ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          Saving...
                        </>
                      ) : 'Save Prescription'}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </div>
    );
  };

  const LoginView = ({ type, icon, title, subtitle, onSubmit }) => {
    const [loginError, setLoginError] = useState('');
    const [email, setEmail]           = useState('');
    const [password, setPassword]     = useState('');
    const [voiceState, setVoiceState] = useState('idle');
    const [voiceMsg, setVoiceMsg]     = useState('');
    const accentColor = type === 'staff' ? 'bg-secondary' : 'bg-accent';
    const recRef      = useRef(null);
    const emailRef    = useRef(null);
    const passwordRef = useRef(null);

    const stopVoice = () => {
      if (recRef.current) { recRef.current.stop(); recRef.current = null; }
      setVoiceState('idle');
    };

    const toggleVoice = () => {
      if (voiceState === 'listening') { stopVoice(); return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { setVoiceMsg('Voice input not supported. Use Chrome.'); setVoiceState('error'); return; }
      const active = document.activeElement;
      const isEmail    = active === emailRef.current;
      const isPassword = active === passwordRef.current;
      if (!isEmail && !isPassword) { setVoiceMsg('Please click a field first.'); setVoiceState('error'); return; }
      setVoiceMsg(''); setVoiceState('listening');
      const rec = new SR();
      rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const t = e.results[0][0].transcript.trim();
        if (!t) return;
        if (isEmail)    setEmail(prev    => prev + t);
        if (isPassword) setPassword(prev => prev + t);
      };
      rec.onerror = (e) => {
        recRef.current = null; setVoiceState('error');
        setVoiceMsg(e.error === 'not-allowed' ? 'Microphone access denied.' : e.error === 'no-speech' ? 'No speech detected.' : 'Voice error. Try again.');
      };
      rec.onend = () => { recRef.current = null; setVoiceState(prev => prev === 'listening' ? 'idle' : prev); };
      recRef.current = rec; rec.start();
    };

    useEffect(() => () => { if (recRef.current) recRef.current.stop(); }, []);

    const handleSubmit = async (e) => {
      e.preventDefault(); stopVoice(); setLoginError('');
      try {
        const res  = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const data = await res.json();
        if (!res.ok) { setLoginError(data.error || 'Login failed.'); return; }
        onSubmit(data);
      } catch { setLoginError('Network error. Please try again.'); }
    };

    const isListening = voiceState === 'listening';

    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card max-w-md w-full p-10 text-center">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl ${accentColor}`}>
            {icon}
          </div>
          <h2 className="text-3xl font-bold mb-2">{title}</h2>
          <p className="text-white/40 text-sm mb-8">{subtitle}</p>

          <form onSubmit={handleSubmit} className="space-y-4 text-left">
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">Email</label>
              <input ref={emailRef} type="email" placeholder="Enter email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">Password</label>
              <input ref={passwordRef} type="password" placeholder="Enter password" required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary" />
            </div>
            {loginError && <p className="text-red-400 text-xs">{loginError}</p>}
            {voiceState === 'error' && voiceMsg && <p className="text-red-400 text-xs">{voiceMsg}</p>}
            {isListening && (
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Listening...</span>
              </div>
            )}
            <div className="flex gap-3">
              <button type="submit" className={`flex-1 text-white font-bold py-4 rounded-xl shadow-lg transition-transform hover:scale-[1.02] ${accentColor}`}>
                Sign In
              </button>
              <button type="button" onClick={toggleVoice}
                className={`w-14 rounded-xl flex items-center justify-center transition-all ${
                  isListening ? 'bg-red-500 animate-pulse shadow-lg shadow-red-500/30' : 'bg-white/10 hover:bg-white/20'
                }`}>
                <Mic className="w-5 h-5 text-white" />
              </button>
            </div>
          </form>

          <p className="mt-6 text-white/40 text-sm">
            New user?{' '}
            <button onClick={() => navigateTo('signup')} className="text-primary font-semibold hover:underline">Create an account</button>
          </p>
          <div className="absolute top-6 left-6">
            <BackButton onBack={() => navigateBack(user?.role)} dark={false} />
          </div>
        </motion.div>
      </div>
    );
  };

  // --- Main Render ---
  return (
    <div className="font-sans selection:bg-primary selection:text-white">
      <AnimatePresence mode="wait">
        {view === 'landing' && <LandingPage key="landing" />}
        {view === 'patient-login' && <PatientLogin key="p-login" />}
        {view === 'patient-portal' && <PatientPortal key="p-portal" />}
        {view === 'patient-registration' && (
          <PatientRegistration 
            key="p-reg" 
            user={user} 
            setView={navigateTo} 
            logout={logout} 
            registerNormal={registerNormal}
            onBack={() => navigateBack(user?.role)}
          />
        )}
        {view === 'token-status' && (
          <TokenStatus 
            key="t-status" 
            myToken={myToken} 
            queue={queue} 
            user={user} 
            setView={navigateTo} 
            logout={logout}
            onBack={() => navigateBack(user?.role)}
            onCancel={cancelAppointment}
          />
        )}
        {view === 'staff-login' && (
          <LoginView 
            key="s-login"
            type="staff"
            icon={<Users className="text-white w-8 h-8" />}
            title="Staff Login"
            subtitle="Authorized staff members only"
            onSubmit={handleStaffLogin}
          />
        )}
        {view === 'staff-portal' && <StaffPortal key="s-portal" />}
        {view === 'doctor-login' && (
          <LoginView 
            key="d-login"
            type="doctor"
            icon={<Stethoscope className="text-white w-8 h-8" />}
            title="Doctor Login"
            subtitle="Physician access — authorized users only"
            onSubmit={handleDoctorLogin}
          />
        )}
        {view === 'doctor-portal' && <DoctorPortal key="d-portal" />}
        {view === 'signup' && <SignupView key="signup" setView={navigateTo} onBack={() => navigateBack(user?.role)} />}
      </AnimatePresence>
    </div>
  );
}

// --- Subcomponents ---

// --- Subcomponents ---

const PatientRegistration = ({ user, setView, logout, registerNormal, onBack }) => {
  const [formData, setFormData] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    complaint: ''
  });
  const [voiceState, setVoiceState] = useState('idle'); // idle | listening | error
  const [voiceError, setVoiceError] = useState('');
  const [interimText, setInterimText] = useState('');
  const recRef = useRef(null);

  // Parse a final transcript and fill the matching form field.
  // Supported commands:
  //   "my name is John"  → name
  //   "phone [number]"   → phone
  //   "symptoms / complaint [text]" → complaint
  //   Anything else      → complaint (fallback)
  const parseAndFill = (transcript) => {
    const t = transcript.trim();
    if (!t) return;

    const namePat    = /(?:my name is|name is|i am|i'm)\s+(.+)/i;
    const phonePat   = /(?:my phone(?: number)? is|phone(?: number)? is|phone|number)\s+([\d\s\-+().]+)/i;
    const symptomPat = /(?:my symptoms?(?: are)?|symptoms?(?: are)?|complaint is|i have|i feel|i am feeling|suffering from)\s+(.+)/i;

    const nameMatch    = t.match(namePat);
    const phoneMatch   = t.match(phonePat);
    const symptomMatch = t.match(symptomPat);

    if (nameMatch) {
      setFormData(prev => ({ ...prev, name: nameMatch[1].trim() }));
    } else if (phoneMatch) {
      setFormData(prev => ({ ...prev, phone: phoneMatch[2].trim() }));
    } else if (symptomMatch) {
      setFormData(prev => ({ ...prev, complaint: prev.complaint ? prev.complaint + ' ' + symptomMatch[1].trim() : symptomMatch[1].trim() }));
    } else {
      // Fallback: append to complaint
      setFormData(prev => ({ ...prev, complaint: prev.complaint ? prev.complaint + ' ' + t : t }));
    }
  };

  const stopVoice = () => {
    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
    }
    setVoiceState('idle');
    setInterimText('');
  };

  const toggleVoice = () => {
    if (voiceState === 'listening') { stopVoice(); return; }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError('Voice input is not supported in this browser. Please use Chrome.');
      setVoiceState('error');
      return;
    }

    setVoiceError('');
    setVoiceState('listening');
    setInterimText('');

    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = '';
      let final   = '';
      for (const result of e.results) {
        if (result.isFinal) final   += result[0].transcript;
        else                interim += result[0].transcript;
      }
      setInterimText(interim || final);
      if (final) parseAndFill(final);
    };

    rec.onerror = (e) => {
      recRef.current = null;
      setVoiceState('error');
      setInterimText('');
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        setVoiceError('Microphone access denied. Please allow microphone permission and try again.');
      } else if (e.error === 'no-speech') {
        setVoiceError('No speech detected. Please speak clearly and try again.');
      } else {
        setVoiceError('Voice recognition error. Please try again.');
      }
    };

    rec.onend = () => {
      recRef.current = null;
      setVoiceState(prev => prev === 'listening' ? 'idle' : prev);
      setInterimText('');
    };

    recRef.current = rec;
    rec.start();
  };

  // Clean up on unmount
  useEffect(() => () => { if (recRef.current) recRef.current.stop(); }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    stopVoice();
    registerNormal(formData);
  };

  const isListening = voiceState === 'listening';

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <header className="bg-white border-b border-slate-100 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#3b82f6] rounded-full flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Plus className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-none">MediCare</h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Hospital System</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-50 border border-slate-100">
            <User className="w-4 h-4 text-[#3b82f6]" />
            <span className="text-sm font-semibold">{user?.name}</span>
          </div>
          <button onClick={logout} className="flex items-center gap-2 px-4 py-2 rounded-full border border-red-200 text-red-500 text-sm font-semibold hover:bg-red-50 transition-colors">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto py-8 px-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 text-sm font-medium hover:text-blue-500 transition-colors mb-6"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden"
        >
          <div className="p-10">
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-14 h-14 bg-[#3b82f6] rounded-full flex items-center justify-center text-white shadow-lg shadow-blue-500/20 mb-4">
                <ClipboardList className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-bold">Register in Queue</h2>
              <p className="text-slate-400 text-sm">Fill in your complaint to get a token</p>
            </div>

            {/* Voice Assistant Panel */}
            <div className="bg-[#f0f7ff] rounded-3xl py-5 mb-10 flex flex-col items-center border border-blue-50/50">
              <button
                type="button"
                onClick={toggleVoice}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                  isListening
                    ? 'bg-red-500 animate-pulse shadow-lg shadow-red-500/40'
                    : 'bg-[#3b82f6] shadow-lg shadow-blue-500/40 hover:scale-105'
                }`}
              >
                <Mic className="text-white w-7 h-7" />
              </button>
              {isListening && (
                <div className="flex items-center gap-2 mt-3">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-red-500 uppercase tracking-widest">Listening...</span>
                </div>
              )}
              {voiceState === 'error' && voiceError && (
                <p className="text-xs text-red-500 font-medium mt-2">{voiceError}</p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="text-xs font-bold text-slate-700 mb-2 block">Full Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl px-5 py-4 focus:outline-none focus:border-blue-500 transition-colors font-medium"
                  placeholder="Enter your name"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 mb-2 block">Phone Number</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl px-5 py-4 focus:outline-none focus:border-blue-500 transition-colors font-medium"
                  placeholder="Enter your phone number"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 mb-2 block">Symptoms / Complaint</label>
                <textarea
                  value={formData.complaint}
                  onChange={(e) => setFormData({...formData, complaint: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl px-5 py-4 focus:outline-none focus:border-blue-500 transition-colors font-medium min-h-[120px]"
                  placeholder="Describe your symptoms..."
                />
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-[#3b82f6] to-[#2dd4bf] text-white font-bold py-5 rounded-2xl shadow-xl shadow-blue-500/20 hover:scale-[1.01] active:scale-[0.99] transition-all text-lg"
              >
                Get My Token
              </button>
            </form>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

const TokenStatus = ({ myToken, queue, user, setView, logout, onBack, onCancel }) => {
  const position = useMemo(() => {
    if (!myToken) return 0;

    const myId    = myToken.id    ? String(myToken.id)    : null;
    const myTok   = myToken.token ? String(myToken.token) : null;
    const match   = (p) =>
      (myId  && String(p.id)    === myId)  ||
      (myTok && String(p.token) === myTok);

    // Emergency patients are always ahead of normal patients
    const emergencyIndex = queue.emergency.findIndex(match);
    if (emergencyIndex !== -1) return emergencyIndex + 1;   // always >= 1

    const normalIndex = queue.normal.findIndex(match);
    if (normalIndex !== -1) return queue.emergency.length + normalIndex + 1; // always >= 1

    // Patient is being served or not found — return 0 only in this case
    return 0;
  }, [queue, myToken]);

  const waitTime = useMemo(() => {
    if (!myToken) return 'Serving soon';
    if (position === 0) return 'Serving soon';   // being served or next up
    if (myToken.type === 'emergency') return `~${position * 5} mins`;
    return `~${position * 10} mins`;
  }, [position, myToken]);

  if (!myToken) return <div className="p-20 text-center"><button onClick={onBack}>Back</button></div>;

  const isBeingServed = queue.serving?.token === myToken.token;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="px-8 py-4 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-400 font-semibold hover:text-primary transition-colors">
          <ChevronLeft className="w-5 h-5" />
          Back to Dashboard
        </button>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-50 border border-slate-100">
            <User className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">{user?.name}</span>
          </div>
          <button onClick={logout} className="flex items-center gap-2 px-4 py-2 rounded-full border border-emergency/20 text-emergency text-sm font-semibold hover:bg-emergency/5 transition-colors">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="flex flex-col items-center justify-center py-12 px-6">
        <div className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-secondary/10 text-secondary text-xs font-bold uppercase tracking-widest">
          <div className="w-2 h-2 bg-secondary rounded-full animate-pulse" />
          Live Updates
        </div>

        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`w-full max-w-lg rounded-[40px] p-12 text-white shadow-2xl relative overflow-hidden ${isBeingServed ? 'bg-secondary' : (myToken.type === 'emergency' ? 'bg-emergency' : 'bg-primary')}`}
        >
          {/* Decorative circle */}
          <div className="absolute -top-20 -right-20 w-80 h-80 bg-white/10 rounded-full blur-3xl" />
          
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-60 mb-6">Your Token Number</p>
            <h2 className="text-[120px] font-black leading-none mb-4 tracking-tighter">{myToken.token}</h2>
            <p className="text-xl font-medium opacity-80 mb-12">{user?.name}</p>

            {isBeingServed ? (
              <div className="bg-white/20 backdrop-blur-md rounded-3xl p-8 border border-white/20 text-center">
                 <p className="text-2xl font-bold mb-2">It&apos;s your turn!</p>
                 <p className="text-sm opacity-80">Please proceed to the consultation room.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white/10 backdrop-blur-md rounded-3xl p-6 border border-white/10">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-2">Queue Position</p>
                  {position > 0 ? (
                    <p className="text-3xl font-bold">
                      {position}
                      <span className="text-sm font-medium opacity-60 ml-1">
                        {position === 1 ? 'st' : position === 2 ? 'nd' : position === 3 ? 'rd' : 'th'} in line
                      </span>
                    </p>
                  ) : (
                    <p className="text-xl font-bold opacity-80">Up next</p>
                  )}
                </div>
                <div className="bg-white/10 backdrop-blur-md rounded-3xl p-6 border border-white/10">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-2">Est. Wait Time</p>
                  <p className="text-3xl font-bold">{waitTime}</p>
                </div>
              </div>
            )}
          </div>

          <div className="absolute top-1/2 right-12 -translate-y-1/2 flex flex-col items-center gap-4">
             <div className={`px-6 py-3 backdrop-blur-xl rounded-2xl border flex items-center gap-3 ${isBeingServed ? 'bg-white/30 border-white/30' : 'bg-white/20 border-white/20'}`}>
                {isBeingServed ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                <span className="text-sm font-bold uppercase tracking-widest">{isBeingServed ? 'Now Serving' : 'Waiting in Queue'}</span>
             </div>
             {myToken.type === 'emergency' && (
               <div className="px-6 py-3 bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 flex items-center gap-3">
                  <div className="w-2 h-2 bg-emergency rounded-full animate-pulse" />
                  <span className="text-sm font-bold uppercase tracking-widest">Emergency</span>
               </div>
             )}
          </div>
        </motion.div>
        {!isBeingServed && (
          <div className="mt-6">
            <button
              onClick={() => onCancel(myToken.token)}
              className="px-6 py-3 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-colors"
            >
              Cancel Appointment
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

function PortalCard({ icon, title, description, features, color, onClick }) {
  const textColors = {
    'bg-primary': 'text-primary',
    'bg-secondary': 'text-secondary',
    'bg-accent': 'text-accent'
  };
  const textColor = textColors[color] || 'text-primary';

  return (
    <motion.div 
      onClick={onClick}
      className="glass-card portal-card group"
    >
      <div className={`w-16 h-16 ${color} rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-black/20 group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <h3 className="text-2xl font-bold mb-4">{title}</h3>
      <div className="bg-white/5 w-full h-[1px] mb-6" />
      <p className="text-white/40 text-sm mb-8 leading-relaxed">{description}</p>
      <ul className="w-full space-y-3 mb-10">
        {features.map(f => (
          <li key={f} className="flex items-center gap-3 text-xs font-medium text-white/70">
            <CheckCircle2 className={`w-4 h-4 ${textColor}`} />
            {f}
          </li>
        ))}
      </ul>
      <button className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${color} hover:brightness-110`}>
        Enter Portal <ArrowRight className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

function PortalAction({ icon, title, description, disabled, status, color, onClick, showArrow }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`w-full p-6 rounded-3xl border transition-all flex items-center justify-between group ${disabled ? 'bg-slate-50 border-slate-100 opacity-60 cursor-not-allowed' : 'bg-white border-slate-100 hover:border-primary/30 hover:shadow-xl hover:shadow-slate-200/50'}`}
    >
      <div className="flex items-center gap-6">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg ${color}`}>
          {icon}
        </div>
        <div className="text-left">
          <div className="flex items-center gap-3 mb-1">
            <h4 className="font-bold text-lg">{title}</h4>
            {status && <span className="px-2 py-0.5 bg-slate-100 text-slate-400 text-[8px] font-black uppercase tracking-widest rounded">{status}</span>}
          </div>
          <p className="text-sm text-slate-400 max-w-xs">{description}</p>
        </div>
      </div>
      {showArrow && <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-primary group-hover:translate-x-1 transition-all" />}
    </button>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-6">
      <div className={`w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center ${color}`}>
        {React.cloneElement(icon, { className: "w-6 h-6" })}
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
        <p className="text-3xl font-black">{value}</p>
      </div>
    </div>
  );
}

function SignupView({ setView, onBack }) {
  const [fields, setFields]   = useState({ name: '', email: '', password: '', role: 'staff' });
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Voice assistant state ────────────────────────────────────────────────
  const [voiceState, setVoiceState]   = useState('idle'); // idle | listening | error
  const [voiceError, setVoiceError]   = useState('');
  const [interimText, setInterimText] = useState('');
  const recRef = useRef(null);

  const VALID_ROLES = ['admin', 'staff', 'patient', 'doctor'];

  // Map a final transcript to the correct field.
  // Supported phrases:
  //   "my name is John Doe"        → name
  //   "email john@example.com"     → email
  //   "password secret123"         → password
  //   "role staff"                 → role (validated against VALID_ROLES)
  const parseAndFill = (transcript) => {
    const t = transcript.trim();
    if (!t) return;

    const namePat     = /(?:my name is|name is|i am|i'm)\s+(.+)/i;
    const emailPat    = /(?:email(?: is| address is)?|my email(?: is)?)\s+(\S+@\S+\.\S+)/i;
    const passwordPat = /(?:password(?: is)?|my password(?: is)?)\s+(\S+)/i;
    const rolePat     = /(?:role(?: is)?|my role(?: is)?)\s+(\w+)/i;

    const nameMatch     = t.match(namePat);
    const emailMatch    = t.match(emailPat);
    const passwordMatch = t.match(passwordPat);
    const roleMatch     = t.match(rolePat);

    if (nameMatch) {
      setFields(prev => ({ ...prev, name: nameMatch[1].trim() }));
    } else if (emailMatch) {
      // Speech engines often say "at" instead of "@" and "dot" instead of "."
      const normalised = emailMatch[1]
        .replace(/\s+at\s+/gi, '@')
        .replace(/\s+dot\s+/gi, '.')
        .toLowerCase();
      setFields(prev => ({ ...prev, email: normalised }));
    } else if (passwordMatch) {
      setFields(prev => ({ ...prev, password: passwordMatch[1].trim() }));
    } else if (roleMatch) {
      const spoken = roleMatch[1].toLowerCase().trim();
      if (VALID_ROLES.includes(spoken)) {
        setFields(prev => ({ ...prev, role: spoken }));
      }
    }
  };

  const stopVoice = () => {
    if (recRef.current) { recRef.current.stop(); recRef.current = null; }
    setVoiceState('idle');
    setInterimText('');
  };

  const toggleVoice = () => {
    if (voiceState === 'listening') { stopVoice(); return; }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError('Voice input is not supported in this browser. Please use Chrome.');
      setVoiceState('error');
      return;
    }

    setVoiceError('');
    setVoiceState('listening');
    setInterimText('');

    const rec = new SpeechRecognition();
    rec.lang            = 'en-US';
    rec.interimResults  = true;
    rec.continuous      = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = '', final = '';
      for (const result of e.results) {
        if (result.isFinal) final   += result[0].transcript;
        else                interim += result[0].transcript;
      }
      setInterimText(interim || final);
      if (final) parseAndFill(final);
    };

    rec.onerror = (e) => {
      recRef.current = null;
      setVoiceState('error');
      setInterimText('');
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        setVoiceError('Microphone access denied. Please allow microphone permission and try again.');
      } else if (e.error === 'no-speech') {
        setVoiceError('No speech detected. Please speak clearly and try again.');
      } else {
        setVoiceError('Voice recognition error. Please try again.');
      }
    };

    rec.onend = () => {
      recRef.current = null;
      setVoiceState(prev => prev === 'listening' ? 'idle' : prev);
      setInterimText('');
    };

    recRef.current = rec;
    rec.start();
  };

  // Clean up on unmount
  useEffect(() => () => { if (recRef.current) recRef.current.stop(); }, []);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    stopVoice();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      const res  = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Signup failed.'); return; }
      setSuccess('Account created! Redirecting to login...');
      setTimeout(() => setView(fields.role === 'doctor' ? 'doctor-login' : fields.role === 'patient' ? 'patient-login' : 'staff-login'), 1500);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isListening = voiceState === 'listening';

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card max-w-md w-full p-10 text-center">
        <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/20">
          <Plus className="text-white w-8 h-8" />
        </div>
        <h2 className="text-3xl font-bold mb-2">Create Account</h2>
        <p className="text-white/40 text-sm mb-6">Register a new account</p>
        <div className="absolute top-6 left-6">
          <BackButton onBack={onBack} dark={false} />
        </div>

        {/* ── Voice assistant panel ── */}
        <div className="flex flex-col items-center mb-6">
          <button
            type="button"
            onClick={toggleVoice}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              isListening
                ? 'bg-red-500 animate-pulse shadow-lg shadow-red-500/40'
                : 'bg-primary shadow-lg shadow-primary/30 hover:scale-105'
            }`}
          >
            <Mic className="text-white w-5 h-5" />
          </button>
          {isListening && (
            <div className="flex items-center gap-2 mt-2">
              <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
              <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Listening...</span>
            </div>
          )}
          {voiceState === 'error' && voiceError && (
            <p className="text-[11px] text-red-400 font-medium mt-2">{voiceError}</p>
          )}
        </div>

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">Full Name</label>
            <input
              name="name" type="text" placeholder="e.g. Dr. Jane Smith" required
              value={fields.name}
              onChange={e => setFields(prev => ({ ...prev, name: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">Email</label>
            <input
              name="email" type="email" placeholder="you@hospital.com" required
              value={fields.email}
              onChange={e => setFields(prev => ({ ...prev, email: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">Password</label>
            <input
              name="password" type="password" placeholder="Min. 8 characters" required minLength={8}
              value={fields.password}
              onChange={e => setFields(prev => ({ ...prev, password: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">Role</label>
            <select
              name="role"
              value={fields.role}
              onChange={e => setFields(prev => ({ ...prev, role: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary appearance-none"
            >
              <option value="staff">Staff</option>
              <option value="doctor">Doctor</option>
              <option value="admin">Admin</option>
              <option value="patient">Patient</option>
            </select>
          </div>
          {error   && <p className="text-red-400 text-xs">{error}</p>}
          {success && <p className="text-green-400 text-xs">{success}</p>}
          <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-primary to-secondary text-white font-bold py-4 rounded-xl shadow-lg hover:scale-[1.02] transition-transform disabled:opacity-60">
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-white/40 text-sm">
          Already have an account?{' '}
          <button onClick={() => setView('staff-login')} className="text-primary font-semibold hover:underline">Sign in</button>
        </p>
      </motion.div>
    </div>
  );
}

// ── BackButton ─────────────────────────────────────────────────────────────
// dark=true  → slate text (for light backgrounds: portals, forms)
// dark=false → white/translucent text (for dark glass-card backgrounds)
function BackButton({ onBack, dark = true }) {
  return (
    <button
      onClick={onBack}
      className={`flex items-center gap-1.5 text-sm font-semibold transition-colors p-2 rounded-full ${
        dark
          ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
          : 'text-white/40 hover:text-white hover:bg-white/10'
      }`}
      aria-label="Go back"
    >
      <ChevronLeft className="w-5 h-5" />
      <span className="sr-only">Back</span>
    </button>
  );
}

// ── DoctorNotes ───────────────────────────────────────────────────────────────
// Defined outside App so it never remounts on parent re-renders,
// which is the root cause of the focus-loss bug when typing.
function DoctorNotes({ patientId, socket, requestHardCopy, requestHardCopyState, setImageModal, setImageUrl,
  notes, setNotes, selectedTests, setSelectedTests, followUp, setFollowUp, followUpDays, setFollowUpDays
}) {
  const TESTS = ['MRI', 'CT', 'Blood Work', 'X-Ray', 'Reflex Test'];
  const FOLLOW_UP_OPTIONS = [3, 5, 7, 10, 14];

  const [recognizing, setRecognizing] = useState(false);
  const recRef = useRef(null);

  // Reset is handled by App via useEffect on queue.serving?.id
  useEffect(() => () => stopDictation(), []);

  const stopDictation = () => {
    if (recRef.current) { recRef.current.stop(); recRef.current = null; }
    setRecognizing(false);
  };

  const toggleDictation = () => {
    if (recognizing) { stopDictation(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition not supported. Use Chrome.'); return; }
    const rec = new SR();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    rec.onresult = (ev) => {
      const transcript = Array.from(ev.results).map(r => r[0].transcript).join('');
      setNotes(prev => prev ? prev + ' ' + transcript : transcript);
    };
    rec.onerror = () => { recRef.current = null; setRecognizing(false); };
    rec.onend  = () => { recRef.current = null; setRecognizing(false); };
    recRef.current = rec;
    rec.start();
    setRecognizing(true);
  };

  const toggleTest = (t) =>
    setSelectedTests(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const sendTests = () => {
    if (!patientId || !selectedTests.length) return;
    socket.emit('setPendingTests', { patientId, tests: selectedTests });
    setSelectedTests([]);
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-100 space-y-5">
      <h3 className="text-lg font-bold">Doctor Notes</h3>

      {/* ── Notes textarea ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-slate-700">Notes &amp; Observations</label>
          <button
            type="button"
            onClick={toggleDictation}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
              recognizing ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            {recognizing ? 'Stop Dictation' : 'Dictate'}
          </button>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder="Enter diagnosis, treatment plan, observations..."
          className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:border-primary transition-colors resize-none"
        />
        {recognizing && (
          <div className="flex items-center gap-2 mt-1">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Listening...</span>
          </div>
        )}
      </div>

      {/* ── Request Tests ── */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">Request Tests</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {TESTS.map(t => (
            <label key={t} className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selectedTests.includes(t)}
                onChange={() => toggleTest(t)}
                className="w-4 h-4 accent-primary"
              />
              {t}
            </label>
          ))}
        </div>
      </div>

      {/* ── Follow-up ── */}
      <div className="border-t border-slate-100 pt-4">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={followUp}
            onChange={e => setFollowUp(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm font-semibold text-slate-700">Schedule Follow-up</span>
        </label>
        {followUp && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-sm text-slate-500">Follow up after</span>
            <select
              value={followUpDays}
              onChange={e => setFollowUpDays(Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-sm font-semibold focus:outline-none focus:border-primary"
            >
              {FOLLOW_UP_OPTIONS.map(d => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
            <span className="text-sm text-slate-400">Follow up after {followUpDays} days</span>
          </div>
        )}
      </div>

      {/* ── Action buttons ── */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={sendTests}
          disabled={!selectedTests.length}
          className="px-4 py-2 bg-secondary text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-secondary/90 transition-colors"
        >
          Send Tests
        </button>
        <button
          type="button"
          onClick={() => { setImageModal(true); setImageUrl(''); }}
          className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          View Images
        </button>
        <button
          type="button"
          onClick={() => requestHardCopy(patientId)}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            requestHardCopyState ? 'bg-amber-100 text-amber-700' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {requestHardCopyState ? 'Requested!' : 'Hard Copy'}
        </button>
      </div>
    </div>
  );
}

function QueueSection({ title, count, patients, color, showEscalate, onEscalate, onRemove }) {
  const colorClasses = {
    primary: 'bg-primary text-primary border-primary/20',
    secondary: 'bg-secondary text-secondary border-secondary/20',
    emergency: 'bg-emergency text-emergency border-emergency/20'
  };

  const c = colorClasses[color] || colorClasses.primary;

  return (
    <div className="bg-white rounded-[32px] p-8 shadow-lg shadow-slate-200/50 border border-slate-100">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${c.split(' ')[0]}`} />
          <h3 className="text-xl font-bold">{title}</h3>
        </div>
        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${c.split(' ')[0].replace('bg-', 'bg-').concat('/10')} ${c.split(' ')[1]}`}>
          {count}
        </span>
      </div>
      <div className="space-y-4">
        {patients.map(p => (
          <div key={p.token} className="p-4 rounded-2xl border border-slate-100 flex items-center justify-between group hover:border-primary/30 transition-colors">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className={`font-bold ${c.split(' ')[1]}`}>{p.token}</span>
                <span className="font-bold text-slate-700">{p.name}</span>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-slate-400">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {p.waitTime || '15 mins'}</span>
                {p.complaint && <span className="truncate max-w-[150px]">{p.complaint}</span>}
              </div>
            </div>
            <div className="flex gap-2">
                {showEscalate && (
                <button 
                  onClick={() => onEscalate && onEscalate(p.token)}
                  className="px-3 py-1.5 rounded-lg border border-emergency/20 text-emergency text-[10px] font-bold uppercase tracking-widest hover:bg-emergency/5"
                >
                  Move to Emergency
                </button>
              )}
              <button 
                onClick={() => onRemove && onRemove(p.token)}
                className="p-2 text-slate-300 hover:text-emergency transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {patients.length === 0 && (
          <div className="py-10 text-center text-slate-300 italic text-sm">No patients in this queue</div>
        )}
      </div>
    </div>
  );
}
