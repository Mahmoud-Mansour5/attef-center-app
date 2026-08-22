/* ==========================================================================
   db.js — ATEF CENTER | سنتر عاطف — طبقة البيانات (Supabase)
   كل الدوال هنا Async وتتصل مباشرة بقاعدة بيانات Supabase (PostgreSQL).
   الجداول: users, grade_levels, subjects, teachers, groups, students,
            student_groups, daily_records, student_payments, expenses
   ========================================================================== */
const SUPABASE_URL = 'https://kyorazacuqpgjzzmtkda.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5b3JhemFjdXFwZ2p6em10a2RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MDE2OTcsImV4cCI6MjEwMTM3NzY5N30.7EPdNsIFRbHbQFHnV3DqRkLrA3rwGZNK4tqlYgW8Kr0';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DB = (() => {
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const nowTimeStr = () => new Date().toTimeString().slice(0, 8); // HH:MM:SS
  const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const todayDayName = () => AR_DAYS[new Date().getDay()]; // اسم اليوم الحالي بالعربي (يطابق قيم day_of_week في جدول groups)
  /* Simple in-memory cache of "current" collections so the UI can render
     synchronously after an initial async load(). refresh*() functions below
     re-pull from Supabase and update this cache. */
  const cache = {
    centerInfo: { nameAr: 'سنتر عاطف', nameEn: 'ATTEF CENTER', tagline: 'نظام إدارة السنتر التعليمي المتكامل' },
    users: [],
    gradeLevels: [],
    subjects: [],
    teachers: [],
    groups: [],
    students: [],
    studentGroups: [],
    dailyRecords: [],
    studentPayments: [],
    expenses: [],
  };

  function logErr(scope, error) {
    if (error) {
      // تسجيل تفصيلي كامل لأي خطأ قادم من Supabase لتسهيل تتبع أسباب "فشل الحفظ"
      console.error(`[Supabase:${scope}] فشلت العملية ⚠️`, {
        message: error.message || null,
        details: error.details || null,
        hint: error.hint || null,
        code: error.code || null,
        raw: error,
      });
    }
    return error;
  }

  /* ================= Bootstrap: pull everything once ================= */
  async function refreshAll() {
    await Promise.all([
      refreshUsers(), refreshGradeLevels(), refreshSubjects(), refreshTeachers(),
      refreshGroups(), refreshStudents(), refreshStudentGroups(),
      refreshDailyRecords(), refreshStudentPayments(),
    ]);
  }

  async function refreshUsers() {
    const { data, error } = await supabaseClient.from('users').select('*');
    if (error) return logErr('users', error);
    cache.users = data || [];
  }
  async function refreshGradeLevels() {
    const { data, error } = await supabaseClient.from('grade_levels').select('*').order('created_at', { ascending: true });
    if (error) return logErr('grade_levels', error);
    cache.gradeLevels = data || [];
  }
  async function refreshSubjects() {
    const { data, error } = await supabaseClient.from('subjects').select('*');
    if (error) return logErr('subjects', error);
    cache.subjects = data || [];
  }
  async function refreshTeachers() {
    const { data, error } = await supabaseClient.from('teachers').select('*');
    if (error) return logErr('teachers', error);
    cache.teachers = data || [];
  }
  async function refreshGroups() {
    const { data, error } = await supabaseClient.from('groups').select('*');
    if (error) return logErr('groups', error);
    cache.groups = data || [];
  }
  async function refreshStudents() {
    const { data, error } = await supabaseClient.from('students').select('*');
    if (error) return logErr('students', error);
    cache.students = data || [];
  }
  async function refreshStudentGroups() {
    const { data, error } = await supabaseClient.from('student_groups').select('*');
    if (error) return logErr('student_groups', error);
    cache.studentGroups = data || [];
  }
  // دالة مساعدة لحساب تاريخ من 30 يوم فاتوا
  const getThirtyDaysAgoDate = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  };

  async function refreshDailyRecords() {
    const thirtyDaysAgoStr = getThirtyDaysAgoDate().toISOString().slice(0, 10); // YYYY-MM-DD
    
    // هنجيب بس السجلات اللي تاريخها أكبر من أو يساوي 30 يوم فاتوا
    const { data, error } = await supabaseClient
      .from('daily_records')
      .select('*')
      .gte('session_date', thirtyDaysAgoStr) 
      .order('session_date', { ascending: false });
      
    if (error) return logErr('daily_records', error);
    cache.dailyRecords = data || [];
  }

  async function refreshStudentPayments() {
    const thirtyDaysAgoISO = getThirtyDaysAgoDate().toISOString();
    
    // هنجيب المدفوعات لآخر 30 يوم بس
    const { data, error } = await supabaseClient
      .from('student_payments')
      .select('*')
      .gte('payment_date', thirtyDaysAgoISO)
      .order('payment_date', { ascending: false });
      
    if (error) { cache.studentPayments = []; return; }
    cache.studentPayments = data || [];
  }
  async function refreshExpenses() {
    const { data, error } = await supabaseClient.from('expenses').select('*');
    if (error) { cache.expenses = []; return; } // expenses table optional
    cache.expenses = data || [];
  }

  return {
    /* expose the raw client + cache + bootstrap for app.js */
    client: supabaseClient,
    cache,
    refreshAll,
    refreshUsers, refreshGradeLevels, refreshSubjects, refreshTeachers, refreshGroups,
    refreshStudents, refreshStudentGroups, refreshDailyRecords, refreshStudentPayments, refreshExpenses,

    /* ---------------- Center info (kept local — no dedicated table requested) ---------------- */
    getCenterInfo() { return { ...cache.centerInfo }; },
    updateCenterInfo(info) {
      cache.centerInfo = { ...cache.centerInfo, ...info };
      localStorage.setItem('atef_center_info', JSON.stringify(cache.centerInfo));
      return cache.centerInfo;
    },
    loadCenterInfoLocal() {
      try {
        const raw = localStorage.getItem('atef_center_info');
        if (raw) cache.centerInfo = { ...cache.centerInfo, ...JSON.parse(raw) };
      } catch (e) { /* ignore */ }
    },

    /* ---------------- Auth / Users ---------------- */
    async login(username, password) {
      const { data, error } = await supabaseClient
        .from('users')
        .select('*')
        .ilike('username', String(username).trim())
        .eq('password_hash', password) // ⚠️ مقارنة مباشرة مؤقتاً — استبدلها بتشفير حقيقي (bcrypt) في الإنتاج
        .maybeSingle();
      if (error) { logErr('login', error); return null; }
      return data || null;
    },
    getUsers() { return [...cache.users]; },
    async addUser({ username, password, role, name, teacherId, phone }) {
      const payload = {
        username: username.trim(), password_hash: password, role,
        full_name: name.trim(), teacher_id: teacherId || null, phone: phone || '',
      };
      const { data, error } = await supabaseClient.from('users').insert(payload).select().single();
      if (error) { logErr('addUser', error); return { error: error.message }; }
      cache.users.push(data);
      return data;
    },
    async updateUser(id, updates) {
      const patch = {};
      if (updates.username !== undefined) patch.username = updates.username;
      if (updates.password !== undefined) patch.password_hash = updates.password;
      if (updates.name !== undefined) patch.full_name = updates.name;
      if (updates.phone !== undefined) patch.phone = updates.phone;
      const { data, error } = await supabaseClient.from('users').update(patch).eq('id', id).select().single();
      if (error) return logErr('updateUser', error);
      const idx = cache.users.findIndex(u => u.id === id);
      if (idx > -1) cache.users[idx] = data;
      return data;
    },
    async deleteUser(id) {
      const { error } = await supabaseClient.from('users').delete().eq('id', id);
      if (error) return logErr('deleteUser', error);
      cache.users = cache.users.filter(u => u.id !== id);
    },

    /* ---------------- Secretaries (users where role='secretary') ---------------- */
    getSecretaries() { return cache.users.filter(u => u.role === 'secretary').sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ar')); },
    async addSecretary({ username, password, name, phone }) {
      if (!username?.trim() || !password?.trim() || !name?.trim()) return { error: 'اسم المستخدم وكلمة المرور والاسم إجباريون' };
      return this.addUser({ username, password, role: 'secretary', name, phone });
    },
    async updateSecretary(id, updates) { return this.updateUser(id, updates); },
    async deleteSecretary(id) { return this.deleteUser(id); },

    /* ---------------- Grade levels (dynamic school years) ---------------- */
    getGradeLevelRows() { return [...cache.gradeLevels]; },
    getGradeLevelById(id) { return cache.gradeLevels.find(g => String(g.id) === String(id)) || null; },
    async addGradeLevel({ name }) {
      const trimmed = (name || '').trim();
      if (!trimmed) return { error: 'اسم السنة الدراسية مطلوب' };
      const { data, error } = await supabaseClient.from('grade_levels').insert({ name: trimmed }).select().single();
      if (error) { logErr('addGradeLevel', error); return { error: error.message }; }
      cache.gradeLevels.push(data);
      return data;
    },
    async deleteGradeLevel(id) {
      const { error } = await supabaseClient.from('grade_levels').delete().eq('id', id);
      if (error) return logErr('deleteGradeLevel', error);
      cache.gradeLevels = cache.gradeLevels.filter(g => g.id !== id);
    },

    /* ---------------- Subjects (linked dynamically to grade_levels) ---------------- */
    getSubjects() { return [...cache.subjects]; },
    getSubjectsByGradeLevel(gradeLevelId) {
      return cache.subjects.filter(s => String(s.grade_level_id) === String(gradeLevelId));
    },
    async addSubject({ name, gradeLevelId }) {
      const trimmed = (name || '').trim();
      if (!trimmed || !gradeLevelId) return { error: 'اسم المادة والسنة الدراسية مطلوبان' };
      const { data, error } = await supabaseClient.from('subjects').insert({ name: trimmed, grade_level_id: gradeLevelId }).select().single();
      if (error) { logErr('addSubject', error); return { error: error.message }; }
      cache.subjects.push(data);
      return data;
    },
    async deleteSubject(id) {
      const { error } = await supabaseClient.from('subjects').delete().eq('id', id);
      if (error) return logErr('deleteSubject', error);
      cache.subjects = cache.subjects.filter(s => s.id !== id);
    },

    /* ---------------- Teachers ---------------- */
    getTeachers() { return [...cache.teachers].sort((a, b) => a.name.localeCompare(b.name, 'ar')); },
    getTeacherById(id) { return cache.teachers.find(t => String(t.id) === String(id)) || null; },
    async addTeacher({ name, subjectId, gradeLevel, gradeLevelId, phone, profitPercentage }) {
      const payload = {
        name: name.trim(), subject_id: subjectId || null,
        grade_level: gradeLevel || null, grade_level_id: gradeLevelId || null,
        phone: phone || '', profit_percentage: Number(profitPercentage) || 0,
      };
      const { data, error } = await supabaseClient.from('teachers').insert(payload).select().single();
      if (error) { logErr('addTeacher', error); return null; }
      cache.teachers.push(data);
      return data;
    },
    async updateTeacher(id, updates) {
      const patch = {};
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.subjectId !== undefined) patch.subject_id = updates.subjectId;
      if (updates.gradeLevel !== undefined) patch.grade_level = updates.gradeLevel;
      if (updates.gradeLevelId !== undefined) patch.grade_level_id = updates.gradeLevelId;
      if (updates.phone !== undefined) patch.phone = updates.phone;
      if (updates.profitPercentage !== undefined) patch.profit_percentage = Number(updates.profitPercentage) || 0;
      const { data, error } = await supabaseClient.from('teachers').update(patch).eq('id', id).select().single();
      if (error) return logErr('updateTeacher', error);
      const idx = cache.teachers.findIndex(t => t.id === id);
      if (idx > -1) cache.teachers[idx] = data;
      return data;
    },
    async deleteTeacher(id) {
      await supabaseClient.from('users').delete().eq('teacher_id', id);
      const { error } = await supabaseClient.from('teachers').delete().eq('id', id);
      if (error) return logErr('deleteTeacher', error);
      cache.teachers = cache.teachers.filter(t => t.id !== id);
      cache.users = cache.users.filter(u => u.teacher_id !== id);
    },
    getStudentsCountForTeacher(teacherId) {
      const groupIds = cache.groups.filter(g => String(g.teacher_id) === String(teacherId)).map(g => g.id);
      const studentIds = new Set(cache.studentGroups.filter(sg => groupIds.includes(sg.group_id)).map(sg => sg.student_id));
      return studentIds.size;
    },

    /* ---------------- Groups ---------------- */
    getGroups() { return [...cache.groups]; },
    getGroupById(id) { return cache.groups.find(g => String(g.id) === String(id)) || null; },
    getGroupsByTeacher(teacherId) { return cache.groups.filter(g => String(g.teacher_id) === String(teacherId)); },
    getGroupsByGradeLevel(gradeLevel) { return cache.groups.filter(g => g.grade_level === gradeLevel); },
    async addGroup({ teacherId, subjectId, gradeLevel, gradeLevelId, dayOfWeek, timeStart, pricePerSession }) {
      const payload = {
        teacher_id: teacherId, subject_id: subjectId, grade_level: gradeLevel, grade_level_id: gradeLevelId || null,
        day_of_week: dayOfWeek || null, time_start: timeStart || null,
        price_per_session: Number(pricePerSession) || 0,
      };
      const { data, error } = await supabaseClient.from('groups').insert(payload).select().single();
      if (error) { logErr('addGroup', error); return null; }
      cache.groups.push(data);
      return data;
    },

    // ➕ الدالة الجديدة لتعديل المجموعة
    async updateGroup(id, updates) {
      const patch = {};
      if (updates.teacherId !== undefined) patch.teacher_id = updates.teacherId;
      if (updates.subjectId !== undefined) patch.subject_id = updates.subjectId;
      if (updates.gradeLevel !== undefined) patch.grade_level = updates.gradeLevel;
      if (updates.gradeLevelId !== undefined) patch.grade_level_id = updates.gradeLevelId;
      if (updates.dayOfWeek !== undefined) patch.day_of_week = updates.dayOfWeek;
      if (updates.timeStart !== undefined) patch.time_start = updates.timeStart;
      if (updates.pricePerSession !== undefined) patch.price_per_session = Number(updates.pricePerSession) || 0;

      const { data, error } = await supabaseClient.from('groups').update(patch).eq('id', id).select().single();
      if (error) return logErr('updateGroup', error);
      const idx = cache.groups.findIndex(g => g.id === id);
      if (idx > -1) cache.groups[idx] = data;
      return data;
    },


    async deleteGroup(id) {
      const { error } = await supabaseClient.from('groups').delete().eq('id', id);
      if (error) return logErr('deleteGroup', error);
      cache.groups = cache.groups.filter(g => g.id !== id);
    },

    /* ---------------- Students ---------------- */
    getStudents() { return [...cache.students].sort((a, b) => a.name.localeCompare(b.name, 'ar')); },
    getStudentById(id) { return cache.students.find(s => String(s.id) === String(id) || s.student_code === String(id)) || null; },
    getStudentByCode(code) { return cache.students.find(s => s.student_code === String(code)) || null; },
    getStudentGroupIds(studentId) {
      return cache.studentGroups.filter(sg => String(sg.student_id) === String(studentId)).map(sg => sg.group_id);
    },
    /* يرجع كائنات المجموعات الكاملة (وليس فقط الـ IDs) التي يشترك بها الطالب — لدعم تعدد المواد */
    getGroupsForStudent(studentId) {
      const ids = this.getStudentGroupIds(studentId);
      return cache.groups.filter(g => ids.includes(g.id));
    },
    /* اسم اليوم الحالي بالعربي — يطابق تماماً قيم day_of_week في جدول groups (مثال: الأحد) */
    getTodayDayName() { return todayDayName(); },
    /* مجموعات الطالب التي تُقام اليوم فقط — أساس فلترة كارت السكرتير الذكي */
    getGroupsForStudentToday(studentId) {
      const today = todayDayName();
      return this.getGroupsForStudent(studentId).filter(g => g.day_of_week === today);
    },
    getStudentsByGroup(groupId) {
      const ids = cache.studentGroups.filter(sg => String(sg.group_id) === String(groupId)).map(sg => sg.student_id);
      return cache.students.filter(s => ids.includes(s.id));
    },
    async addStudent({ studentCode, name, gradeLevel, phone, parentPhone, groupId, groupIds }) {
      const payload = {
        student_code: studentCode.trim(), name: name.trim(), grade_level: gradeLevel || null,
        phone: phone || '', parent_phone: parentPhone || '', total_debt: 0,
      };
      const { data, error } = await supabaseClient.from('students').insert(payload).select().single();
      if (error) { logErr('addStudent', error); return { error: error.message }; }
      cache.students.push(data);

      // تعدد المواد: سلة (Cart) من المجموعات → Loop لإنشاء سجلات متعددة في student_groups
      const idsToEnroll = Array.isArray(groupIds) && groupIds.length ? groupIds : (groupId ? [groupId] : []);
      for (const gid of idsToEnroll) {
        await this.enrollStudentInGroup(data.id, gid);
      }
      return data;
    },
    /* إلغاء اشتراك طالب من مجموعة معيّنة — تعدد المواد، شاشة تعديل الطالب */
    async unenrollStudentFromGroup(studentId, groupId) {
      const { error } = await supabaseClient.from('student_groups').delete()
        .eq('student_id', studentId).eq('group_id', groupId);
      if (error) return logErr('unenrollStudentFromGroup', error);
      cache.studentGroups = cache.studentGroups.filter(sg => !(String(sg.student_id) === String(studentId) && String(sg.group_id) === String(groupId)));
    },
    async updateStudent(id, updates) {
      const patch = {};
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.gradeLevel !== undefined) patch.grade_level = updates.gradeLevel;
      if (updates.phone !== undefined) patch.phone = updates.phone;
      if (updates.parentPhone !== undefined) patch.parent_phone = updates.parentPhone;
      if (updates.totalDebt !== undefined) patch.total_debt = Number(updates.totalDebt) || 0;
      if (updates.studentCode !== undefined) patch.student_code = updates.studentCode;
      const { data, error } = await supabaseClient.from('students').update(patch).eq('id', id).select().single();
      if (error) return logErr('updateStudent', error);
      const idx = cache.students.findIndex(s => s.id === id);
      if (idx > -1) cache.students[idx] = data;
      return data;
    },
    async adjustStudentDebt(id, deltaAmount) {
      const student = this.getStudentById(id);
      if (!student) return null;
      const newDebt = Math.max(0, Number(student.total_debt || 0) + Number(deltaAmount || 0));
      return this.updateStudent(id, { totalDebt: newDebt });
    },
    async deleteStudent(id) {
      await supabaseClient.from('student_groups').delete().eq('student_id', id);
      const { error } = await supabaseClient.from('students').delete().eq('id', id);
      if (error) return logErr('deleteStudent', error);
      cache.students = cache.students.filter(s => s.id !== id);
      cache.studentGroups = cache.studentGroups.filter(sg => sg.student_id !== id);
    },
    async enrollStudentInGroup(studentId, groupId) {
      const { data, error } = await supabaseClient
        .from('student_groups')
        .insert({ student_id: studentId, group_id: groupId, joined_at: new Date().toISOString() })
        .select().single();
      if (error) return logErr('enrollStudentInGroup', error);
      cache.studentGroups.push(data);
      return data;
    },
    getGradeLevels() {
      // أسماء السنوات الدراسية الديناميكية — من جدول grade_levels أولاً، مع رجوع لقيم الطلاب كتوافقية
      if (cache.gradeLevels.length) return cache.gradeLevels.map(g => g.name);
      return [...new Set(cache.students.map(s => s.grade_level).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    },

    /* ---------------- Daily Records (attendance + payment + grades) ---------------- */
    getDailyRecords() { return [...cache.dailyRecords]; },
    getPendingRecords() {
      return cache.dailyRecords.filter(r => !r.is_approved).sort((a, b) => new Date(b.session_date) - new Date(a.session_date));
    },
    getApprovedRecords() {
      return cache.dailyRecords.filter(r => r.is_approved);
    },
    /* إذا مُرِّر groupId، يبحث عن سجل اليوم الخاص بهذا الطالب في هذه المجموعة بالتحديد
       (ضروري لدعم تعدد المواد — نفس الطالب ممكن يحضر أكتر من مجموعة في نفس اليوم).
       لو متمررش groupId، يرجع أي سجل لليوم (توافقية مع الأماكن اللي لسه مش محتاجة تفرقة بالمجموعة). */
    getRecordForStudentToday(studentId, groupId) {
      const today = todayStr();
      if (groupId) {
        return cache.dailyRecords.find(r => String(r.student_id) === String(studentId) && String(r.group_id) === String(groupId) && r.session_date === today) || null;
      }
      return cache.dailyRecords.find(r => String(r.student_id) === String(studentId) && r.session_date === today) || null;
    },
    getPendingRecordForStudentToday(studentId, groupId) {
      const r = this.getRecordForStudentToday(studentId, groupId);
      return r && !r.is_approved ? r : null;
    },
    getApprovedRecordForStudentToday(studentId, groupId) {
      const r = this.getRecordForStudentToday(studentId, groupId);
      return r && r.is_approved ? r : null;
    },
    async saveRecord(record) {
      const today = todayStr();
      const groupIds = this.getStudentGroupIds(record.studentId);
      const groupId = record.groupId || groupIds[0] || null;
      const existing = this.getRecordForStudentToday(record.studentId, groupId);

      const oldRemaining = Number(existing?.remaining_amount) || 0;
      const newRemaining = record.remainingAmount !== undefined ? Number(record.remainingAmount) : oldRemaining;

      const payload = {
        student_id: record.studentId,
        group_id: groupId,
        session_date: today,
        time_in: record.timeIn ?? existing?.time_in ?? nowTimeStr(),
        amount_paid: record.amountPaid !== undefined ? Number(record.amountPaid) || 0 : (existing?.amount_paid ?? 0),
        remaining_amount: newRemaining,
        secretary_id: record.secretaryId ?? existing?.secretary_id ?? null,
        secretary_name: record.secretaryName ?? existing?.secretary_name ?? '',
        exam_grade: record.examGrade !== undefined ? record.examGrade : (existing?.exam_grade ?? null),
        exam_out_of: record.examOutOf ?? existing?.exam_out_of ?? 20,
        homework_grade: record.homeworkGrade !== undefined ? record.homeworkGrade : (existing?.homework_grade ?? null),
        homework_out_of: record.homeworkOutOf ?? existing?.homework_out_of ?? 20,
        teacher_notes: record.teacherNotes !== undefined ? record.teacherNotes : (existing?.teacher_notes ?? ''),
        teacher_submitted: record.teacherSubmitted !== undefined ? record.teacherSubmitted : (existing?.teacher_submitted ?? false),
        is_approved: false,
        attendance: record.attendance ?? existing?.attendance ?? 'absent',
        payment_status: record.paymentStatus ?? existing?.payment_status ?? 'unpaid',
      };

      let data, error;
      if (existing) {
        ({ data, error } = await supabaseClient.from('daily_records').update(payload).eq('id', existing.id).select().single());
      } else {
        ({ data, error } = await supabaseClient.from('daily_records').insert(payload).select().single());
      }
      if (error) return logErr('saveRecord', error);

      const idx = cache.dailyRecords.findIndex(r => r.id === data.id);
      if (idx > -1) cache.dailyRecords[idx] = data; else cache.dailyRecords.unshift(data);

      let debtChange = newRemaining - oldRemaining;
      if (debtChange !== 0) await this.adjustStudentDebt(record.studentId, debtChange);

      const oldPaid = Number(existing?.amount_paid) || 0;
      const newPaid = Number(payload.amount_paid);
      if (newPaid - oldPaid > 0) {
        await this.addPayment({
          studentId: record.studentId,
          amount: newPaid - oldPaid,
          secretaryId: record.secretaryId ?? null,
          notes: record.paymentNotes || (existing ? 'تحديث دفعة' : 'دفع أثناء الحضور'),
        });
      }

      return data;
    },

    async updateRecord(id, updates) {
      const existing = cache.dailyRecords.find(r => String(r.id) === String(id));
      if (!existing) return null;

      const oldPaid = Number(existing.amount_paid) || 0;
      const newPaid = updates.amountPaid !== undefined ? Number(updates.amountPaid) : oldPaid;

      const oldRemaining = Number(existing.remaining_amount) || 0;
      const newRemaining = updates.remainingAmount !== undefined ? Number(updates.remainingAmount) : oldRemaining;

      const patch = {};
      if (updates.attendance !== undefined) patch.attendance = updates.attendance;
      if (updates.paymentStatus !== undefined) patch.payment_status = updates.paymentStatus;
      if (updates.examGrade !== undefined) patch.exam_grade = updates.examGrade;
      if (updates.examOutOf !== undefined) patch.exam_out_of = updates.examOutOf;
      if (updates.homeworkGrade !== undefined) patch.homework_grade = updates.homeworkGrade;
      if (updates.homeworkOutOf !== undefined) patch.homework_out_of = updates.homeworkOutOf;
      if (updates.teacherNotes !== undefined) patch.teacher_notes = updates.teacherNotes;
      if (updates.amountPaid !== undefined) patch.amount_paid = newPaid;
      if (updates.remainingAmount !== undefined) patch.remaining_amount = newRemaining;

      const { data, error } = await supabaseClient.from('daily_records').update(patch).eq('id', id).select().single();
      if (error) return logErr('updateRecord', error);

      let debtChange = newRemaining - oldRemaining;
      if (debtChange !== 0) await this.adjustStudentDebt(existing.student_id, debtChange);
      
      if (newPaid - oldPaid !== 0) {
        await this.addPayment({
          studentId: existing.student_id,
          amount: newPaid - oldPaid,
          notes: 'تسوية رصيد (تعديل من الإدارة)'
        });
      }

      const idx = cache.dailyRecords.findIndex(r => String(r.id) === String(id));
      if (idx > -1) cache.dailyRecords[idx] = data;
      return data;
    },

    async deleteRecord(id) {
      const existing = cache.dailyRecords.find(r => String(r.id) === String(id));
      if (existing) {
        const oldPaid = Number(existing.amount_paid) || 0;
        const oldRemaining = Number(existing.remaining_amount) || 0;
        
        let debtChange = -oldRemaining;
        if (debtChange !== 0) await this.adjustStudentDebt(existing.student_id, debtChange);
        
        if (oldPaid > 0) {
          await this.addPayment({ studentId: existing.student_id, amount: -oldPaid, notes: 'إلغاء سجل (حذف)' });
        }
      }
      
      const { error } = await supabaseClient.from('daily_records').delete().eq('id', id);
      if (error) return logErr('deleteRecord', error);
      
      cache.dailyRecords = cache.dailyRecords.filter(r => String(r.id) !== String(id));
    },
    /* اعتماد سجل: يخصم المتبقي غير المخصوم (إن وجد) من مديونية الطالب ويعلّم السجل معتمد */
    async approveRecord(id) {
      const record = cache.dailyRecords.find(r => r.id === id);
      if (!record) return null;
      const { data, error } = await supabaseClient.from('daily_records').update({ is_approved: true }).eq('id', id).select().single();
      if (error) return logErr('approveRecord', error);
      const idx = cache.dailyRecords.findIndex(r => r.id === id);
      if (idx > -1) cache.dailyRecords[idx] = data;
      return data;
    },
    async approveAll() {
      const pendingIds = this.getPendingRecords().map(r => r.id);
      if (!pendingIds.length) return [];
      const { data, error } = await supabaseClient.from('daily_records').update({ is_approved: true }).in('id', pendingIds).select();
      if (error) return logErr('approveAll', error);
      data.forEach(d => {
        const idx = cache.dailyRecords.findIndex(r => r.id === d.id);
        if (idx > -1) cache.dailyRecords[idx] = d;
      });
      return data;
    },
    async submitTeacherReport(studentId, { groupId, examGrade, examOutOf, homeworkGrade, homeworkOutOf, notes, teacherName }) {
      return this.saveRecord({
        studentId, groupId, examGrade, examOutOf, homeworkGrade, homeworkOutOf,
        teacherNotes: notes, teacherSubmitted: true, secretaryName: teacherName,
      });
    },
    /* إرسال تقرير المجموعة كاملاً: أي طالب بالمجموعة ليس له سجل حضور اليوم (لم يمر على السكرتير)
       يُنشأ له سجل تلقائي بحالة "غائب" حتى لا يفوت أي طالب من تقرير اليوم (الحالة 3). */
    async finalizeGroupReport(groupId, teacherName) {
      const students = this.getStudentsByGroup(groupId);
      const created = [];
      for (const student of students) {
        const existing = this.getRecordForStudentToday(student.id, groupId);
        if (existing) continue;
        const rec = await this.saveRecord({
          studentId: student.id,
          groupId,
          attendance: 'absent',
          paymentStatus: 'unpaid',
          teacherSubmitted: true,
          secretaryName: teacherName || 'المدرس',
        });
        if (rec) created.push(rec);
      }
      return created;
    },

    /* ---------------- Student payments (detailed ledger) ---------------- */
    getStudentPayments() { return [...cache.studentPayments]; },
    getPaymentsForStudent(studentId) {
      return cache.studentPayments
        .filter(p => String(p.student_id) === String(studentId))
        .sort((a, b) => new Date(b.payment_date) - new Date(a.payment_date));
    },
    async addPayment({ studentId, amount, secretaryId, notes }) {
      const payload = {
        student_id: studentId,
        amount: Number(amount) || 0,
        secretary_id: secretaryId || null,
        payment_date: new Date().toISOString(),
        notes: notes || '',
      };
      const { data, error } = await supabaseClient.from('student_payments').insert(payload).select().single();
      if (error) { logErr('addPayment', error); return null; }
      cache.studentPayments.unshift(data);
      return data;
    },
    async deletePayment(id) {
      const { error } = await supabaseClient.from('student_payments').delete().eq('id', id);
      if (error) return logErr('deletePayment', error);
      cache.studentPayments = cache.studentPayments.filter(p => p.id !== id);
    },

    /* ---------------- Expenses (local table, optional) ---------------- */
    getExpenses() { return [...cache.expenses]; },
    async addExpense({ name, amount, note }) {
      const payload = { name: name.trim(), amount: Number(amount) || 0, note: note || '' };
      const { data, error } = await supabaseClient.from('expenses').insert(payload).select().single();
      if (error) { logErr('addExpense', error); return null; }
      cache.expenses.push(data);
      return data;
    },
    async deleteExpense(id) {
      const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
      if (error) return logErr('deleteExpense', error);
      cache.expenses = cache.expenses.filter(e => e.id !== id);
    },

    /* ---------------- Stats ---------------- */
    getStats() {
      const today = todayStr();
      return {
        totalStudents: cache.students.length,
        activeGroups: cache.groups.length,
        pendingApprovals: this.getPendingRecords().length,
        approvedToday: cache.dailyRecords.filter(r => r.is_approved && r.session_date === today).length,
        totalTeachers: cache.teachers.length,
        totalSecretaries: cache.users.filter(u => u.role === 'secretary').length,
      };
    },

    /* يحدد مجموعات المدرس المحدد ويرجع Set من group_id — أساس التصفية حسب المدرس في الماليات */
    _groupIdsForTeacherFilter(teacherId) {
      if (!teacherId || teacherId === 'all') return null;
      return new Set(cache.groups.filter(g => String(g.teacher_id) === String(teacherId)).map(g => g.id));
    },
    /* ---------------- Finance summary ---------------- */
    getFinanceSummary(fromDate, toDate, teacherId, groupId) {
      let records = cache.dailyRecords;
      if (fromDate) records = records.filter(r => r.session_date >= fromDate);
      if (toDate) records = records.filter(r => r.session_date <= toDate);
      if (groupId && groupId !== 'all') records = records.filter(r => String(r.group_id) === String(groupId));
      const teacherGroupIds = this._groupIdsForTeacherFilter(teacherId);
      if (teacherGroupIds) records = records.filter(r => teacherGroupIds.has(r.group_id));

      // المصدر الأدق للمُحصَّل هو سجل student_payments التفصيلي، مع رجوع لـ daily_records
      // كتوافقية لو الجدول الجديد لسه فاضي (بيانات قديمة قبل التحديث)
      // ملاحظة: عند التصفية حسب مدرس/مجموعة نعتمد على daily_records مباشرة لأن student_payments لا يحمل group_id
      const hasCrossFilter = (teacherId && teacherId !== 'all') || (groupId && groupId !== 'all');
      let payments = cache.studentPayments;
      if (fromDate) payments = payments.filter(p => (p.payment_date || '').slice(0, 10) >= fromDate);
      if (toDate) payments = payments.filter(p => (p.payment_date || '').slice(0, 10) <= toDate);

      const totalCollected = hasCrossFilter
        ? records.reduce((sum, r) => sum + (Number(r.amount_paid) || 0), 0)
        : (payments.length ? payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
                            : records.reduce((sum, r) => sum + (Number(r.amount_paid) || 0), 0));

      const totalOutstanding = cache.students.reduce((sum, s) => sum + (Number(s.total_debt) || 0), 0);
      const totalExpenses = hasCrossFilter ? 0 : cache.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const netProfit = totalCollected - totalExpenses;

      return { totalCollected, totalOutstanding, totalExpenses, netProfit, filteredRecords: records, filteredPayments: payments };
    },
    /* سجل الدفعات التفصيلي لصفحة الماليات — كل دفعة، متى، ومن السكرتير
       التصفية حسب مدرس/مجموعة تتم عبر daily_records بنفس تاريخ الدفعة والطالب (لأن الدفعة نفسها بلا group_id) */
    getPaymentLedgerRows(fromDate, toDate, teacherId, groupId) {
      let payments = cache.studentPayments;
      if (fromDate) payments = payments.filter(p => (p.payment_date || '').slice(0, 10) >= fromDate);
      if (toDate) payments = payments.filter(p => (p.payment_date || '').slice(0, 10) <= toDate);

      const teacherGroupIds = this._groupIdsForTeacherFilter(teacherId);
      const hasCrossFilter = teacherGroupIds || (groupId && groupId !== 'all');
      if (hasCrossFilter) {
        payments = payments.filter(p => {
          const day = (p.payment_date || '').slice(0, 10);
          return cache.dailyRecords.some(r =>
            String(r.student_id) === String(p.student_id) && r.session_date === day &&
            (groupId && groupId !== 'all' ? String(r.group_id) === String(groupId) : true) &&
            (teacherGroupIds ? teacherGroupIds.has(r.group_id) : true)
          );
        });
      }

      return payments.map(p => {
        const student = this.getStudentById(p.student_id);
        const secretary = cache.users.find(u => String(u.id) === String(p.secretary_id));
        return {
          id: p.id,
          date: (p.payment_date || '').slice(0, 10),
          time: (p.payment_date || '').slice(11, 19),
          studentName: student?.name || '—',
          studentCode: student?.student_code || '—',
          amount: Number(p.amount) || 0,
          secretaryName: secretary?.full_name || secretary?.username || '—',
          notes: p.notes || '',
        };
      });
    },

    /* تفصيل المديونية لطالب معيّن: كل حصة سابقة لم تُدفع بالكامل (المدفوع أقل من سعر الحصة أو صفر) */
    /* تفصيل المديونية لطالب معيّن: الاعتماد على المبلغ المتبقي الجديد */
    getDebtDetailsForStudent(studentId) {
      return cache.dailyRecords
        .filter(r => String(r.student_id) === String(studentId))
        .map(r => {
          const group = this.getGroupById(r.group_id);
          const price = Number(group?.price_per_session) || 0;
          const paid = Number(r.amount_paid) || 0;
          
          // التعديل هنا: قراءة "المبلغ المتبقي" من العمود الجديد اللي ضفناه
          const remaining = Number(r.remaining_amount) || 0; 
          
          return { record: r, group, price, paid, remaining };
        })
        .filter(x => x.remaining > 0)
        .sort((a, b) => new Date(b.record.session_date) - new Date(a.record.session_date))
        .map(x => ({
          date: x.record.session_date,
          groupLabel: x.group ? (this.getSubjects().find(s => s.id === x.group.subject_id)?.name || x.group.grade_level || 'مجموعة') : '—',
          teacherName: x.group ? (this.getTeacherById(x.group.teacher_id)?.name || '—') : '—',
          price: x.price,
          paid: x.paid,
          remaining: x.remaining,
        }));
    },

    /* ---------------- Master table (joins everything for export) ---------------- */
    getMasterTableRows(fromDate, toDate) {
      let records = cache.dailyRecords;
      if (fromDate) records = records.filter(r => r.session_date >= fromDate);
      if (toDate) records = records.filter(r => r.session_date <= toDate);

      return records.map(r => {
        const student = this.getStudentById(r.student_id);
        const group = this.getGroupById(r.group_id);
        const teacher = group ? this.getTeacherById(group.teacher_id) : null;
        return {
          date: r.session_date,
          studentCode: student?.student_code || '—',
          studentName: student?.name || '—',
          gradeLevel: student?.grade_level || '—',
          teacherName: teacher?.name || '—',
          timeIn: r.time_in || '—',
          attendance: r.attendance === 'present' ? 'حاضر' : r.attendance === 'absent' ? 'غائب' : '—',
          amountPaid: r.amount_paid || 0,
          homework: `${r.homework_grade ?? '—'}/${r.homework_out_of ?? '—'}`,
          exam: `${r.exam_grade ?? '—'}/${r.exam_out_of ?? '—'}`,
          notes: r.teacher_notes || '',
          approved: r.is_approved ? 'نعم' : 'لا',
          totalDebt: student?.total_debt || 0,
        };
      });
    },
    /* ---------------- Master table (joins everything for export) ---------------- */
    getMasterTableRows(fromDate, toDate) {
      let records = cache.dailyRecords;
      if (fromDate) records = records.filter(r => r.session_date >= fromDate);
      if (toDate) records = records.filter(r => r.session_date <= toDate);

      return records.map(r => {
        const student = this.getStudentById(r.student_id);
        const group = this.getGroupById(r.group_id);
        const teacher = group ? this.getTeacherById(group.teacher_id) : null;
        return {
          date: r.session_date,
          studentCode: student?.student_code || '—',
          studentName: student?.name || '—',
          gradeLevel: student?.grade_level || '—',
          teacherName: teacher?.name || '—',
          timeIn: r.time_in || '—',
          attendance: r.attendance === 'present' ? 'حاضر' : r.attendance === 'absent' ? 'غائب' : '—',
          amountPaid: r.amount_paid || 0,
          homework: `${r.homework_grade ?? '—'}/${r.homework_out_of ?? '—'}`,
          exam: `${r.exam_grade ?? '—'}/${r.exam_out_of ?? '—'}`,
          notes: r.teacher_notes || '',
          approved: r.is_approved ? 'نعم' : 'لا',
          totalDebt: student?.total_debt || 0,
        };
      });
    },

    /* ---------------- Real-Time Sync ---------------- */
    initRealtimeSync() {
      // نتصنت على أي تغيير (إضافة، تعديل، حذف) في جدول السجلات اليومية
      supabaseClient
        .channel('daily_records_channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_records' }, (payload) => {
          const record = payload.new;
          const oldRecord = payload.old;
          
          if (payload.eventType === 'INSERT') {
            // لو طالب جديد اتسجل، ضيفه لأول القائمة محلياً
            cache.dailyRecords.unshift(record);
          } else if (payload.eventType === 'UPDATE') {
            // لو تم اعتماد أو تعديل طالب
            const idx = cache.dailyRecords.findIndex(r => String(r.id) === String(record.id));
            if (idx > -1) cache.dailyRecords[idx] = record;
          } else if (payload.eventType === 'DELETE') {
            // لو تم حذف سجل
            cache.dailyRecords = cache.dailyRecords.filter(r => String(r.id) !== String(oldRecord.id));
          }
          
          // نطلق حدث (Event) عشان المتصفح يعرف إن في تحديث حصل
          window.dispatchEvent(new CustomEvent('db_updated'));
        })
        .subscribe();
    },

    /* ---------------- Misc ---------------- */
    async resetAll() {
      console.warn('resetAll تعطلت عن العمل التلقائي مع Supabase لتفادي حذف بيانات إنتاجية بالخطأ.');
    },
  };
})();