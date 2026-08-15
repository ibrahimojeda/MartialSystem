// ══════════════════════════════════════════════════════════════
// workflow-engine.js — Motor de flujos de trabajo de simulación
// ══════════════════════════════════════════════════════════════

const { ErrorTracker } = require('./error-tracker');
const dg = require('./data-generator');

class WorkflowEngine {
  constructor(supabaseAdmin, options = {}) {
    this.sb = supabaseAdmin;
    this.tracker = new ErrorTracker();
    this.chaosRate = options.chaosRate || 0; // 0-100
    this.speed = options.speed || 'normal'; // 'fast', 'normal', 'step'
    this.onProgress = options.onProgress || (() => {});
    this._pauseRequested = false;
    this._stopRequested = false;
    this._running = false;

    // State
    this.establishments = [];
    this.profiles = []; // { id, role, username, fullName, establishmentId }
    this.students = [];
    this.enrollments = [];
    this.classes = [];
    this.disciplineIds = {}; // code -> id mapping
  }

  // ─── Control ───
  pause() { this._pauseRequested = true; }
  resume() { this._pauseRequested = false; }
  stop() { this._stopRequested = true; }

  async _waitIfPaused() {
    while (this._pauseRequested && this._running) {
      await this._sleep(200);
    }
    if (this._stopRequested) throw new Error('SIMULATION_STOPPED');
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  _delay() {
    if (this.speed === 'fast') return this._sleep(50);
    if (this.speed === 'step') return this._sleep(500);
    return this._sleep(150);
  }

  // ─── API helper that wraps Supabase with tracking ───
  async _apiCall(label, fn, requestData = null) {
    const start = Date.now();
    try {
      // Chaos mode: inject random failures
      if (this.chaosRate > 0 && Math.random() * 100 < this.chaosRate) {
        throw new Error(`CHAOS: Random failure injected at ${label}`);
      }
      const result = await fn();
      const elapsed = Date.now() - start;
      this.tracker.recordOperation(label, 'INTERNAL', 200, elapsed, result, requestData);
      this.onProgress({ type: 'success', label, elapsed, result, requestData });
      return result;
    } catch (err) {
      const elapsed = Date.now() - start;
      const statusCode = err.message?.startsWith('CHAOS:') ? 500 : 400;
      this.tracker.recordOperation(label, 'INTERNAL', statusCode, elapsed, err.message, requestData);
      this.onProgress({ type: 'error', label, error: err.message, elapsed, requestData });
      return null;
    }
  }

  // ─── Load discipline IDs ───
  async loadDisciplines() {
    const { data } = await this.sb.from('disciplines').select('id, code, name');
    if (data) {
      data.forEach(d => { this.disciplineIds[d.code] = d.id; });
    }
    return data || [];
  }

  // ══════════════════════════════════════════════════════════════
  // MAIN SIMULATION FLOW
  // ══════════════════════════════════════════════════════════════
  async runSimulation(params) {
    const {
      establishmentCount = 1,
      studentCount = 20,
      instructorsPerEst = 2,
      senseisPerEst = 1,
      guardianRatio = 0.3,
      disciplineCodes = ['karate', 'judo'],
      daysToSimulate = 30,
      classesPerWeek = 5,
      evaluationChance = 0.15,
      paymentChance = 0.8,
      startDate = null
    } = params;

    this._running = true;
    this._stopRequested = false;
    this._pauseRequested = false;
    this.tracker.reset();

    const simStartDate = startDate || new Date(Date.now() - daysToSimulate * 86400000).toISOString().slice(0, 10);
    const simEndDate = new Date().toISOString().slice(0, 10);

    this.onProgress({ type: 'phase', phase: 'start', message: 'Iniciando simulación...' });

    try {
      // Phase 1: Load disciplines
      await this.loadDisciplines();
      const validCodes = disciplineCodes.filter(c => this.disciplineIds[c]);
      if (validCodes.length === 0) throw new Error('No valid discipline codes found');

      // Phase 2: Create establishments
      await this._waitIfPaused();
      this.onProgress({ type: 'phase', phase: 'establishments', message: `Creando ${establishmentCount} establecimiento(s)...` });
      const estData = dg.generateEstablishmentData(establishmentCount);
      for (const est of estData) {
        await this._waitIfPaused();
        await this._delay();
        await this._createEstablishment(est, validCodes);
      }
      this.onProgress({ type: 'phase', phase: 'establishments_done', message: `✅ ${this.establishments.length} establecimiento(s) creados: ${this.establishments.map(e => e.name).join(', ')}` });

      // Phase 3: Create staff per establishment
      for (const est of this.establishments) {
        await this._waitIfPaused();
        this.onProgress({ type: 'phase', phase: 'staff', message: `Creando staff para ${est.name}...` });

        // Create senseis
        for (let i = 0; i < senseisPerEst; i++) {
          await this._waitIfPaused();
          await this._delay();
          await this._createUser(est.id, 'sensei', i);
        }

        // Create instructors
        for (let i = 0; i < instructorsPerEst; i++) {
          await this._waitIfPaused();
          await this._delay();
          await this._createUser(est.id, 'instructor', i);
        }

        // Create guardians
        const guardianCount = Math.max(1, Math.round(studentCount * guardianRatio / establishmentCount));
        for (let i = 0; i < guardianCount; i++) {
          await this._waitIfPaused();
          await this._delay();
          await this._createUser(est.id, 'guardian', i);
        }
      }

      // Phase 4: Create students
      await this._waitIfPaused();
      this.onProgress({ type: 'phase', phase: 'students', message: `Creando ${studentCount} alumno(s)...` });
      let createdStudents = 0;
      let linkedGuardians = 0;
      const studentsPerEst = Math.ceil(studentCount / establishmentCount);
      for (const est of this.establishments) {
        const estInstructors = this.profiles.filter(p => p.role === 'instructor' && p.establishmentId === est.id);
        const estSenseis = this.profiles.filter(p => p.role === 'sensei' && p.establishmentId === est.id);
        const estGuardians = this.profiles.filter(p => p.role === 'guardian' && p.establishmentId === est.id);

        for (let i = 0; i < studentsPerEst; i++) {
          await this._waitIfPaused();
          await this._delay();
          const student = dg.generateStudents(1, validCodes)[0];
          const instructor = dg.pick(estInstructors.length > 0 ? estInstructors : estSenseis);
          student.instructorProfileId = instructor?.id || null;
          student.disciplineCodes = [dg.pick(validCodes)];
          await this._createStudent(est.id, student, instructor);

          // Link some students to guardians
          if (estGuardians.length > 0 && Math.random() < guardianRatio) {
            const guardian = dg.pick(estGuardians);
            const linkOk = await this._linkGuardian(est.id, guardian.id, student._createdId);
            if (linkOk) linkedGuardians++;
          }
          if (student._createdId) createdStudents++;
        }
      }
      this.onProgress({ type: 'phase', phase: 'students_done', message: `✅ ${createdStudents} alumno(s) creados, ${linkedGuardians} vinculados a guardianes.` });

      // Phase 5: Simulate day-by-day operations
      await this._waitIfPaused();
      this.onProgress({ type: 'phase', phase: 'operations', message: `Simulando ${daysToSimulate} días de operaciones...` });
      let classCount = 0;
      let paymentCount = 0;
      let evalCount = 0;
      let attendanceCount = 0;

      const currentDate = new Date(simStartDate);
      const endDate = new Date(simEndDate);
      let dayIndex = 0;

      while (currentDate <= endDate) {
        await this._waitIfPaused();
        if (this._stopRequested) break;

        const dateStr = currentDate.toISOString().slice(0, 10);
        const dayOfWeek = currentDate.getDay();

        this.onProgress({
          type: 'day',
          date: dateStr,
          dayIndex: ++dayIndex,
          totalDays: daysToSimulate
        });

        // Create class sessions (weekday classes)
        if (dayOfWeek > 0 && dayOfWeek < 6 && Math.random() < (classesPerWeek / 5)) {
          for (const est of this.establishments) {
            const estInstructors = this.profiles.filter(p => (p.role === 'instructor' || p.role === 'sensei') && p.establishmentId === est.id);
            if (estInstructors.length === 0) continue;

            await this._delay();
            const discCode = dg.pick(validCodes);
            const instructor = dg.pick(estInstructors);
            const startTime = dg.randomTime();
            const endHour = parseInt(startTime.split(':')[0]) + 1;
            const classTitle = `Clase ${discCode} ${dateStr} ${startTime}`;

              const location = `Sala ${dg.rand(1, 5)}`;
              const result = await this._apiCall('POST /api/classes', async () => {
                return this.sb.from('class_sessions').insert({
                  establishment_id: est.id,
                  discipline_id: this.disciplineIds[discCode],
                  instructor_profile_id: instructor.id,
                  title: classTitle,
                  scheduled_date: dateStr,
                  start_time: startTime,
                  end_time: `${String(endHour).padStart(2, '0')}:00`,
                  location,
                  status: 'completed'
                }).select('id').single();
              }, { discipline: discCode, date: dateStr, start_time: startTime, location, instructor: instructor?.username || instructor?.id });

            if (result?.data?.id) {
              this.classes.push({ id: result.data.id, establishmentId: est.id, date: dateStr, discipline: discCode });

              // Take attendance for this class
              const enrolledStudents = this.students.filter(s =>
                s.establishmentId === est.id &&
                s.disciplineCodes?.includes(discCode)
              );

              if (enrolledStudents.length > 0) {
                const attendanceEntries = enrolledStudents.map(s => ({
                  class_session_id: result.data.id,
                  student_id: s._createdId,
                  status: dg.generateAttendanceStatus(),
                  marked_at: new Date(dateStr + 'T' + startTime + ':00Z').toISOString()
                }));

                await this._delay();
                await this._apiCall('POST /api/attendance', async () => {
                  return this.sb.from('class_attendance_records').insert(attendanceEntries);
                }, { class_session_id: result.data.id, discipline: discCode, registros: attendanceEntries.length, alumnos: enrolledStudents.map(s => s.fullName) });
              }
            }
          }
        }

        // Register payments
        if (Math.random() < paymentChance) {
          const activeStudents = this.students.filter(s => s._createdId);
          const payStudents = dg.pickN(activeStudents, Math.ceil(activeStudents.length * 0.3));
          for (const s of payStudents) {
            await this._delay();
            const amount = dg.rand(30, 100);
            const method = dg.pick(dg.PAYMENT_METHODS);
            await this._apiCall('POST /api/payments', async () => {
              return this.sb.from('payments').insert({
                establishment_id: s.establishmentId,
                student_id: s._createdId,
                discipline_id: this.disciplineIds[s.disciplineCodes?.[0]] || null,
                amount,
                currency: 'USD',
                method,
                concept: 'Mensualidad',
                paid_at: new Date(dateStr + 'T12:00:00Z').toISOString()
              });
            }, { estudiante: s.fullName, monto: `$${amount}`, metodo: method, disciplina: s.disciplineCodes?.[0], fecha: dateStr });
          }
        }

        // Evaluations (less frequent)
        if (Math.random() < evaluationChance) {
          const evalStudents = dg.pickN(this.students.filter(s => s._createdId), Math.ceil(this.students.length * 0.1));
          for (const s of evalStudents) {
            await this._delay();
            const evalResult = dg.generateEvaluationResult();
            const discCode = s.disciplineCodes?.[0] || validCodes[0];
            const nextRank = evalResult.passed ? dg.getRandomRank(discCode) : null;

            await this._apiCall('POST /api/evaluations', async () => {
              return this.sb.from('student_evaluations').insert({
                establishment_id: s.establishmentId,
                discipline_id: this.disciplineIds[discCode],
                student_id: s._createdId,
                evaluator_profile_id: s.instructorProfileId || this.profiles.find(p => p.establishmentId === s.establishmentId && p.role === 'instructor')?.id,
                score: evalResult.score,
                passed: evalResult.passed,
                notes: evalResult.notes,
                next_rank: nextRank,
                evaluated_at: new Date(dateStr + 'T14:00:00Z').toISOString()
              });
            }, { estudiante: s.fullName, disciplina: discCode, score: evalResult.score, aprobado: evalResult.passed ? 'SI' : 'NO', siguiente_rank: nextRank });
          }
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Phase 6: Notifications
      await this._waitIfPaused();
      this.onProgress({ type: 'phase', phase: 'notifications', message: 'Creando notificaciones...' });
      for (const est of this.establishments) {
        await this._delay();
        await this._apiCall('POST /api/notifications', async () => {
          return this.sb.from('notifications').insert({
            establishment_id: est.id,
            audience_role: 'all',
            title: 'Bienvenido al sistema',
            body: 'El simulador ha completado la carga de datos exitosamente.',
            is_read: false
          });
        }, { establecimiento: est.name, audience_role: 'all', titulo: 'Bienvenido al sistema' });
      }

      // Phase 7: Marketplace items
      await this._waitIfPaused();
      this.onProgress({ type: 'phase', phase: 'marketplace', message: 'Creando productos del marketplace...' });
      for (const est of this.establishments) {
        for (let i = 0; i < 5; i++) {
          await this._delay();
          const mpTitle = dg.pick(['Guantes de sparring', 'Protector bucal', 'Cinturón', 'Uniforme Dobok', 'Vendas', 'Kimono', 'Protectores de tibia', 'Saco de boxeo']);
          const mpDisc = dg.pick(validCodes);
          const mpPrice = dg.rand(15, 200);
          await this._apiCall('POST /api/marketplace', async () => {
            return this.sb.from('marketplace_items').insert({
              establishment_id: est.id,
              discipline_id: this.disciplineIds[mpDisc],
              title: mpTitle,
              description: 'Producto de prueba del simulador',
              price: mpPrice,
              is_active: true
            });
          }, { establecimiento: est.name, producto: mpTitle, disciplina: mpDisc, precio: `$${mpPrice}` });
        }
      }

    } catch (err) {
      if (err.message !== 'SIMULATION_STOPPED') {
        this.tracker.recordRawError('simulation', `Error fatal en simulación: ${err.message}`);
        this.onProgress({ type: 'fatal', error: err.message });
      }
    }

    this._running = false;
    this.onProgress({ type: 'phase', phase: 'complete', message: 'Simulación completada' });

    return this.tracker.getSummary();
  }

  // ─── Create establishment via Supabase direct ───
  async _createEstablishment(estData, disciplineCodes) {
    const result = await this._apiCall('POST /api/onboarding (est)', async () => {
      const { data, error } = await this.sb.from('establishments')
        .insert({ name: estData.name, city: estData.city, country: estData.country, is_active: true })
        .select('id, name')
        .single();
      if (error) throw error;
      return data;
    });

    if (result?.id) {
      const est = { id: result.id, name: result.name, city: estData.city, country: estData.country };
      this.establishments.push(est);

      // Add disciplines to establishment
      for (const code of disciplineCodes) {
        if (this.disciplineIds[code]) {
          // Retry helper for upserts to handle intermittent conflicts under concurrency
          const withRetry = async (fn) => {
            let lastErr;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                return await fn();
              } catch (err) {
                lastErr = err;
                // Retry on transient conflicts with a small backoff
                await this._sleep(50 * (attempt + 1));
              }
            }
            throw lastErr;
          };

          await this._apiCall('INSERT establishment_disciplines', async () => {
            await withRetry(async () => {
              const { error } = await this.sb.from('establishment_disciplines')
                .upsert({
                  establishment_id: est.id,
                  discipline_id: this.disciplineIds[code],
                  is_active: true
                }, { onConflict: 'establishment_id,discipline_id' });
              if (error) throw error;
            });
          }, { establishment_id: est.id, discipline_id: this.disciplineIds[code], is_active: true });

          // Add discipline config
          await this._apiCall('INSERT discipline_configs', async () => {
            await withRetry(async () => {
              const { error } = await this.sb.from('discipline_configs')
                .upsert({
                  establishment_id: est.id,
                  discipline_id: this.disciplineIds[code],
                  config: { modules: [{ id: 'students', label: 'Alumnos' }, { id: 'attendance', label: 'Asistencia' }, { id: 'exams', label: 'Examenes' }] }
                }, { onConflict: 'establishment_id,discipline_id' });
              if (error) throw error;
            });
          }, { establishment_id: est.id, discipline_id: this.disciplineIds[code], config: 'modules: students, attendance, exams' });
        }
      }

      // Create owner for this establishment
      await this._createUser(est.id, 'owner', 0);
    }
  }

  // ─── Create user profile + membership ───
  async _createUser(establishmentId, role, index) {
    let userData = dg.generateUserForRole(role, index);
    let email = dg.generateUniqueEmail(userData.username);

    // Try up to 3 attempts to avoid unique constraints (email/username)
    const result = await this._apiCall(`CREATE user (${role})`, async () => {
      let attempt = 0;
      while (attempt < 3) {
        const { data: authData, error: authError } = await this.sb.auth.admin.createUser({
          email,
          password: userData.password,
          email_confirm: true,
          user_metadata: { full_name: userData.fullName, username: userData.username }
        });
        if (!authError && authData?.user?.id) {
          // Create profile
          const { error: profileError } = await this.sb.from('profiles').insert({
            id: authData.user.id,
            full_name: userData.fullName,
            role,
            username: userData.username,
            auth_email: email,
            is_active: true
          });

          // If profile fails due to duplicate username, regenerate and retry
          if (!profileError) {
            const { error: memberError } = await this.sb.from('establishment_members').insert({
              establishment_id: establishmentId,
              profile_id: authData.user.id,
              role
            });
            if (!memberError) {
              return { id: authData.user.id, username: userData.username };
            }
            // membership failed; cleanup profile
            await this.sb.from('profiles').delete().eq('id', authData.user.id);
          } else {
            // profile failed (e.g., duplicate username); delete auth user to avoid orphan
            await this.sb.auth.admin.deleteUser(authData.user.id);
          }
        }

        // Regenerate credentials for retry
        attempt++;
        userData = dg.generateUserForRole(role, index + attempt);
        email = dg.generateUniqueEmail(userData.username);
      }
      throw new Error(`Could not create user after ${3} attempts (${role})`);
    });

    if (result?.id) {
      const profile = {
        id: result.id,
        role,
        username: result.username || userData.username,
        fullName: userData.fullName,
        establishmentId,
        password: userData.password
      };
      this.profiles.push(profile);
      return profile;
    }
    return null;
  }

  // ─── Create student + enrollment ───
  async _createStudent(establishmentId, studentData, instructorProfile) {
    const result = await this._apiCall('POST /api/students', async () => {
      const { data, error } = await this.sb.from('students')
        .insert({
          establishment_id: establishmentId,
          full_name: studentData.fullName,
          email: studentData.email,
          phone: studentData.phone,
          birth_date: studentData.birthDate
        })
        .select('id')
        .single();
      if (error) throw error;

      // Create enrollment
      const discCode = studentData.disciplineCodes?.[0] || 'karate';
      const { data: enrollData, error: enrollError } = await this.sb.from('student_enrollments')
        .insert({
          student_id: data.id,
          discipline_id: this.disciplineIds[discCode],
          instructor_profile_id: instructorProfile?.id || null,
          current_rank: dg.getRandomRank(discCode),
          status: 'active'
        })
        .select('id')
        .single();
      if (enrollError) throw enrollError;

      // Store instructor link
      if (instructorProfile?.id) {
        await this.sb.from('student_enrollments')
          .update({ instructor_profile_id: instructorProfile.id })
          .eq('id', enrollData.id);
      }

      return { studentId: data.id, enrollmentId: enrollData.id };
    });

    if (result?.studentId) {
      studentData._createdId = result.studentId;
      studentData.establishmentId = establishmentId;
      this.students.push(studentData);
      this.enrollments.push(result.enrollmentId);
    }
  }

  // ─── Link guardian to student ───
  async _linkGuardian(establishmentId, guardianProfileId, studentId) {
    if (!studentId || !guardianProfileId) return;
    await this._apiCall('LINK guardian-student', async () => {
      const { error } = await this.sb.from('guardian_students')
        .upsert({
          establishment_id: establishmentId,
          guardian_profile_id: guardianProfileId,
          student_id: studentId,
          relationship: 'tutor'
        }, { onConflict: 'establishment_id,guardian_profile_id,student_id' });
      if (error) throw error;
    });
  }

  getSummary() {
    return {
      ...this.tracker.getSummary(),
      establishments: this.establishments.length,
      profiles: this.profiles.length,
      students: this.students.length,
      enrollments: this.enrollments.length,
      classes: this.classes.length,
      endpointRanking: this.tracker.getEndpointRanking(),
      anomalies: this.tracker.getAnomalies()
    };
  }

  // Datos para el reporte PDF: perfiles (con contraseñas) y establecimientos
  getReportData() {
    return {
      profiles: [...this.profiles],
      establishments: [...this.establishments]
    };
  }

  getStatus() {
    return {
      running: this._running,
      paused: this._pauseRequested,
      stopped: this._stopRequested,
      operations: this.tracker.operations.length,
      errors: this.tracker.errors.length
    };
  }
}

module.exports = { WorkflowEngine };