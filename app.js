/* ==========================================================================
   app.js — ATEF CENTER | سنتر عاطف — Async / Supabase edition
   ========================================================================== */

let session = null;
let activeGroupFilter = 'all';
let html5QrInstance = null;
let confirmResolver = null;
let pendingEditId = null;
let editingTeacherId = null;
let editingStudentFinanceId = null;
let lastTiltEl = null;
let currentPage = 'dashboard';
let scannerBusy = false;
let flashCardStudentId = null; // لو مضبوطة، شاشة الاستقبال تعرض كارت هذا الطالب فقط (وضع الـ Flash Card من الباركود)
let addStudentGroupsCart = []; // سلة المجموعات (تعدد المواد) عند إضافة طالب جديد — { groupId, label }
let editStudentEnrollTarget = null; // studentId الجاري تعديل مجموعاته في شاشة تعديل الطالب
let editingGroupId = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (n) => Number(n || 0).toLocaleString('ar-EG');

/* ==========================================================================
   Theme
   ========================================================================== */
function initTheme() {
  const saved = localStorage.getItem('atef_theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('atef_theme', theme);
  $$('.switch-icon').forEach(i => i.textContent = theme === 'dark' ? '☀️' : '🌙');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ==========================================================================
   3D tilt
   ========================================================================== */
function initTilt() {
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.tilt');
    if (el !== lastTiltEl && lastTiltEl) lastTiltEl.style.transform = '';
    if (el) {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rx = (0.5 - py) * 8;
      const ry = (px - 0.5) * 8;
      el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-3px)`;
    }
    lastTiltEl = el;
  });
  document.addEventListener('mouseleave', () => {
    if (lastTiltEl) { lastTiltEl.style.transform = ''; lastTiltEl = null; }
  });
}

/* ==========================================================================
   Toasts / Confirm
   ========================================================================== */
function toast(message, type = '') {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, 2700);
}
function askConfirm(title, message) {
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmModal').classList.remove('hidden');
  return new Promise((resolve) => { confirmResolver = resolve; });
}
function closeConfirm(result) {
  $('#confirmModal').classList.add('hidden');
  if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
}
function setSyncStatus(state) {
  const badge = $('#syncBadge');
  if (!badge) return;
  badge.classList.remove('online', 'offline', 'syncing');
  if (state === 'syncing') { badge.classList.add('syncing'); badge.innerHTML = '<i class="dot"></i>جاري المزامنة...'; }
  else if (state === 'offline') { badge.classList.add('offline'); badge.innerHTML = '<i class="dot"></i>غير متصل'; }
  else { badge.classList.add('online'); badge.innerHTML = '<i class="dot"></i>متصل'; }
}

/* ==========================================================================
   Login (username / password) — async against Supabase
   ========================================================================== */
function initLogin() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    const submitBtn = $('.login-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري التحقق...';
    try {
      const user = await DB.login(username, password);
      if (!user) {
        $('#loginError').classList.remove('hidden');
        return;
      }
      $('#loginError').classList.add('hidden');
      session = user;
      // حفظ جلسة الدخول محلياً حتى لا يضطر المستخدم لإعادة تسجيل الدخول بعد الـ Refresh
      localStorage.setItem('attef_session', JSON.stringify(user));
      $('#loginUsername').value = ''; $('#loginPassword').value = '';
      await enterApp();
    } catch (err) {
      toast('⚠️ تعذر الاتصال بقاعدة البيانات', 'error');
      console.error(err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'دخول';
    }
  });
}
function roleLabel(role) {
  return role === 'admin' ? 'مدير السنتر' : role === 'teacher' ? 'مدرس' : 'سكرتارية';
}
async function enterApp() {
  setSyncStatus('syncing');
  try {
    await DB.refreshAll();
    setSyncStatus('online');
  } catch (err) {
    setSyncStatus('offline');
    toast('⚠️ حدث خطأ أثناء تحميل البيانات', 'error');
  }

  applyCenterBranding();
  $('#loginModal').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#userRoleBadge').textContent = roleLabel(session.role);
  $('#userNameLabel').textContent = session.full_name || session.username;

  $$('.side-link').forEach(link => {
    const roles = (link.dataset.roles || '').split(',');
    link.classList.toggle('hidden', !roles.includes(session.role));
  });

  const defaultPage = session.role === 'admin' ? 'dashboard' : session.role === 'secretary' ? 'reception' : 'teacherPortal';
  await goToPage(defaultPage);
  refreshSideBadge();
}
function logout() {
  session = null;
  // مسح الجلسة من الـ localStorage فقط عند الضغط الصريح على "تسجيل الخروج"
  localStorage.removeItem('attef_session');
  $('#app').classList.add('hidden');
  $('#loginModal').classList.remove('hidden');
}
function applyCenterBranding() {
  const info = DB.getCenterInfo();
  $$('.login-brand').forEach(el => el.innerHTML = `${info.nameEn.split(' ')[0]} <span>${info.nameEn.split(' ').slice(1).join(' ')}</span>`);
  document.title = `${info.nameEn} — ${info.nameAr} | نظام إدارة السنتر التعليمي`;
}

/* ==========================================================================
   Sidebar navigation
   ========================================================================== */
const PAGE_TITLES = {
  dashboard: ['لوحة التحكم', 'نظرة عامة على السنتر'],
  students: ['شؤون الطلاب', 'إدارة بيانات الطلاب والمديونيات'],
  teachers: ['إدارة المدرسين', 'حسابات وبيانات المدرسين'],
  groups: ['المجموعات', 'إدارة مجموعات المواد والمعلمين'],
  gradeLevels: ['المراحل والمواد', 'إدارة السنوات الدراسية والمواد المرتبطة بها'],
  secretaries: ['إدارة السكرتارية', 'حسابات دخول موظفي الاستقبال'],
  approvals: ['طابور الاعتماد', 'مراجعة واعتماد السجلات اليومية'],
  finance: ['التقارير المالية', 'الأرباح، الخسائر، والمستحقات'],
  master: ['الشيت المجمع', 'كل بيانات الطالب في مكان واحد'],
  reception: ['استقبال وحضور', 'تسجيل الحضور والمدفوعات'],
  teacherPortal: ['لوحة المدرس', 'رصد الدرجات والملاحظات'],
  settings: ['الإعدادات', 'بيانات السنتر والمظهر'],
};
async function goToPage(page) {
  currentPage = page;
  $$('.page').forEach(p => p.classList.add('hidden'));
  const target = $(`#page-${page}`);
  if (target) target.classList.remove('hidden');
  $$('.side-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  const [title, sub] = PAGE_TITLES[page] || ['', ''];
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = sub;
  closeMobileSidebar();
  await renderPage(page);
}
async function renderPage(page) {
  if (page === 'dashboard') renderDashboard();
  else if (page === 'students') renderStudentsDirectory();
  else if (page === 'teachers') renderTeachersDirectory();
  else if (page === 'groups') renderGroupsPage();
  else if (page === 'gradeLevels') renderGradeLevelsPage();
  else if (page === 'secretaries') renderSecretariesPage();
  else if (page === 'approvals') renderApprovalsPage();
  else if (page === 'finance') renderFinancePage();
  else if (page === 'master') renderMasterTable();
  else if (page === 'reception') { renderGroupChips(); renderStudentsList(); }
  else if (page === 'teacherPortal') renderTeacherPortalRoot();
  else if (page === 'settings') renderSettingsPage();
}
function initSidebar() {
  $$('.side-link').forEach(link => {
    link.addEventListener('click', () => goToPage(link.dataset.page));
  });
  $$('[data-goto]').forEach(btn => btn.addEventListener('click', () => goToPage(btn.dataset.goto)));

  $('#sidebarToggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('collapsed');
    $('#sidebarToggle').textContent = $('#sidebar').classList.contains('collapsed') ? '»' : '«';
  });
  $('#mobileMenuBtn').addEventListener('click', () => {
    $('#sidebar').classList.add('mobile-open');
    $('#sidebarBackdrop').classList.remove('hidden');
  });
  $('#sidebarBackdrop').addEventListener('click', closeMobileSidebar);
}
function closeMobileSidebar() {
  $('#sidebar').classList.remove('mobile-open');
  $('#sidebarBackdrop').classList.add('hidden');
}
function refreshSideBadge() {
  const count = DB.getPendingRecords().length;
  $('#sideApprovalBadge').textContent = count;
  const pageBadge = $('#approvalsPageBadge');
  if (pageBadge) pageBadge.textContent = count;
}

/* ==========================================================================
   Dashboard
   ========================================================================== */
function renderDashboard() {
  const stats = DB.getStats();
  $('#statTotalStudents').textContent = stats.totalStudents;
  $('#statActiveGroups').textContent = stats.activeGroups;
  $('#statTotalTeachers').textContent = stats.totalTeachers;
  $('#statTotalSecretaries').textContent = stats.totalSecretaries;
  $('#statPendingApprovals').textContent = stats.pendingApprovals;
  $('#statApprovedToday').textContent = stats.approvedToday;

  const fin = DB.getFinanceSummary();
  $('#dashNetProfit').textContent = fmt(fin.netProfit);
  $('#dashCollected').textContent = fmt(fin.totalCollected);
  $('#dashOutstanding').textContent = fmt(fin.totalOutstanding);

  const pending = DB.getPendingRecords().slice(0, 6);
  const list = $('#dashPendingPreview');
  $('#dashNoApprovals').classList.toggle('hidden', pending.length > 0);
  list.innerHTML = '';
  pending.forEach(r => list.appendChild(buildApprovalCard(r)));
  refreshSideBadge();
}

/* ==========================================================================
   Students Directory (admin)
   ========================================================================== */
function renderStudentsDirGroupFilterOptions() {
  const sel = $('#studentsDirGroupFilter');
  const current = sel.value;
  const groups = DB.getGroups();
  sel.innerHTML = '<option value="all">كل المجموعات</option>' + groups.map(g => {
    const teacher = DB.getTeacherById(g.teacher_id);
    const label = `${g.grade_level || ''} — ${teacher ? teacher.name : 'بدون مدرس'}`;
    return `<option value="${g.id}">${escapeHtml(label)}</option>`;
  }).join('');
  sel.value = current || 'all';
}
function debtBadgeHtml(debt) {
  const d = Number(debt) || 0;
  return `<span class="debt-badge ${d <= 0 ? 'zero' : ''}">${d > 0 ? fmt(d) + ' ج' : 'لا يوجد'}</span>`;
}
function renderStudentsDirectory() {
  renderStudentsDirGroupFilterOptions();
  const search = ($('#studentsDirSearch').value || '').trim().toLowerCase();
  const groupFilter = $('#studentsDirGroupFilter').value;
  const debtFilter = $('#studentsDirPayFilter').value;

  let students = DB.getStudents();
  if (groupFilter !== 'all') {
    students = students.filter(s => DB.getStudentGroupIds(s.id).includes(Number(groupFilter)) || DB.getStudentGroupIds(s.id).includes(groupFilter));
  }
  if (search) students = students.filter(s => s.name.toLowerCase().includes(search) || String(s.student_code).toLowerCase().includes(search));
  if (debtFilter === 'clear') students = students.filter(s => (Number(s.total_debt) || 0) <= 0);
  if (debtFilter === 'debt') students = students.filter(s => (Number(s.total_debt) || 0) > 0);

  const body = $('#studentsDirBody');
  body.innerHTML = '';
  $('#studentsDirEmpty').classList.toggle('hidden', students.length > 0);

  students.forEach(s => {
    const groupIds = DB.getStudentGroupIds(s.id);
    const groupLabels = groupIds.map(gid => {
      const g = DB.getGroupById(gid);
      if (!g) return null;
      const teacher = DB.getTeacherById(g.teacher_id);
      return teacher ? teacher.name : g.grade_level;
    }).filter(Boolean);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${escapeHtml(s.name)}</b></td>
      <td>#${escapeHtml(s.student_code)}</td>
      <td>${escapeHtml(s.grade_level || '—')}</td>
      <td>${groupLabels.length ? escapeHtml(groupLabels.join('، ')) : '—'}</td>
      <td>${escapeHtml(s.parent_phone || '—')}</td>
      <td>${debtBadgeHtml(s.total_debt)}</td>
      <td><button class="row-action-btn" data-edit-student="${s.id}" title="تعديل">✏️</button></td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('[data-edit-student]').forEach(btn => {
    btn.addEventListener('click', () => openStudentFinanceModal(btn.dataset.editStudent));
  });
}
function initStudentsDirectoryFilters() {
  $('#studentsDirSearch').addEventListener('input', renderStudentsDirectory);
  $('#studentsDirGroupFilter').addEventListener('change', renderStudentsDirectory);
  $('#studentsDirPayFilter').addEventListener('change', renderStudentsDirectory);
}

/* ---- Student finance edit modal ---- */
function openStudentFinanceModal(studentId) {
  const student = DB.getStudentById(studentId);
  if (!student) return;
  editingStudentFinanceId = student.id;
  $('#sfStudentName').textContent = `${student.name} — #${student.student_code}`;
  $('#sfCurrentDebt').textContent = fmt(student.total_debt);
  $('#sfStudentCode').value = student.student_code || '';
  $('#sfDebt').value = student.total_debt || 0;
  $('#sfGradeLevel').value = student.grade_level || '';
  $('#sfParentPhone').value = student.parent_phone || '';
  renderSfGroupsChips(student.id);
  resetSfEnrollCascade();
  $('#studentFinanceModal').classList.remove('hidden');
}
/* عرض المواد المشترك بها الطالب حالياً + زر "❌ إلغاء الاشتراك" لكل مادة — تعدد المواد */
function renderSfGroupsChips(studentId) {
  const container = $('#sfGroupsChips');
  const groups = DB.getGroupsForStudent(studentId);
  container.innerHTML = groups.length
    ? groups.map(g => `<span class="subject-chip">${escapeHtml(groupCartLabel(g.id))}<button data-unenroll-group="${g.id}" title="إلغاء الاشتراك">✕</button></span>`).join('')
    : '<span class="sub">لا يوجد اشتراكات حالياً</span>';

  container.querySelectorAll('[data-unenroll-group]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('إلغاء الاشتراك؟', 'سيتم إلغاء اشتراك الطالب في هذه المادة نهائياً.');
    if (!ok) return;
    await DB.unenrollStudentFromGroup(studentId, btn.dataset.unenrollGroup);
    toast('❌ تم إلغاء الاشتراك');
    renderSfGroupsChips(studentId);
    renderStudentsDirectory();
    if (currentPage === 'reception') renderStudentsList();
  }));
}
function resetSfEnrollCascade() {
  fillGradeLevelSelectDynamic($('#sfEnrollGradeLevel'), '');
  $('#sfEnrollSubject').innerHTML = '<option value="">— اختر المرحلة أولاً —</option>';
  $('#sfEnrollTeacher').innerHTML = '<option value="">— اختر المادة أولاً —</option>';
  $('#sfEnrollGroup').innerHTML = '<option value="">— اختر المعلم أولاً —</option>';
  $('#sfEnrollSubject').disabled = true;
  $('#sfEnrollTeacher').disabled = true;
  $('#sfEnrollGroup').disabled = true;
}
function initSfEnrollCascadingSelects() {
  const gradeSel = $('#sfEnrollGradeLevel');
  const subjectSel = $('#sfEnrollSubject');
  const teacherSel = $('#sfEnrollTeacher');
  const groupSel = $('#sfEnrollGroup');

  gradeSel.addEventListener('change', () => {
    const gradeLevelId = gradeSel.value;
    const gradeLevel = DB.getGradeLevelById(gradeLevelId);
    subjectSel.innerHTML = '<option value="">— اختر —</option>';
    teacherSel.innerHTML = '<option value="">— اختر المادة أولاً —</option>';
    groupSel.innerHTML = '<option value="">— اختر المعلم أولاً —</option>';
    subjectSel.disabled = !gradeLevelId; teacherSel.disabled = true; groupSel.disabled = true;
    if (!gradeLevelId) return;
    const subjects = DB.getSubjectsByGradeLevel(gradeLevelId);
    subjectSel.innerHTML = '<option value="">— اختر —</option>' + subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    subjectSel.dataset.gradeLevelName = gradeLevel?.name || '';
  });

  subjectSel.addEventListener('change', () => {
    const gradeLevelName = subjectSel.dataset.gradeLevelName || '';
    const subjectId = subjectSel.value;
    teacherSel.innerHTML = '<option value="">— اختر —</option>';
    groupSel.innerHTML = '<option value="">— اختر المعلم أولاً —</option>';
    teacherSel.disabled = !subjectId; groupSel.disabled = true;
    if (!subjectId) return;
    const matching = DB.getGroupsByGradeLevel(gradeLevelName).filter(g => String(g.subject_id) === String(subjectId));
    const teacherIds = [...new Set(matching.map(g => g.teacher_id))];
    const teachers = DB.getTeachers().filter(t => teacherIds.includes(t.id));
    teacherSel.innerHTML = '<option value="">— اختر —</option>' + teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  });

  teacherSel.addEventListener('change', () => {
    const gradeLevelName = subjectSel.dataset.gradeLevelName || '';
    const subjectId = subjectSel.value;
    const teacherId = teacherSel.value;
    groupSel.innerHTML = '<option value="">— اختر —</option>';
    groupSel.disabled = !teacherId;
    if (!teacherId) return;
    const matching = DB.getGroupsByGradeLevel(gradeLevelName).filter(g => String(g.subject_id) === String(subjectId) && String(g.teacher_id) === String(teacherId));
    groupSel.innerHTML = '<option value="">— اختر —</option>' + matching.map(g => `<option value="${g.id}">${escapeHtml(g.day_of_week || '')} ${escapeHtml(g.time_start || '')}</option>`).join('');
  });

  $('#sfAddGroupBtn').addEventListener('click', async () => {
    const groupId = groupSel.value;
    if (!groupId || !editingStudentFinanceId) { toast('⚠️ من فضلك أكمل اختيار المجموعة', 'error'); return; }
    const already = DB.getStudentGroupIds(editingStudentFinanceId).some(gid => String(gid) === String(groupId));
    if (already) { toast('⚠️ الطالب مسجل بالفعل في هذه المادة', 'error'); return; }
    await DB.enrollStudentInGroup(editingStudentFinanceId, groupId);
    toast('✅ تم تسجيل الطالب في المادة الجديدة', 'success');
    renderSfGroupsChips(editingStudentFinanceId);
    resetSfEnrollCascade();
    renderStudentsDirectory();
    if (currentPage === 'reception') renderStudentsList();
  });
}
function initStudentFinanceModal() {
  $('#studentFinanceModalClose').addEventListener('click', () => $('#studentFinanceModal').classList.add('hidden'));
  $('#sfSaveBtn').addEventListener('click', async () => {
    if (!editingStudentFinanceId) return;
    await DB.updateStudent(editingStudentFinanceId, {
      studentCode: $('#sfStudentCode').value.trim(),
      totalDebt: Number($('#sfDebt').value) || 0,
      gradeLevel: $('#sfGradeLevel').value.trim(),
      parentPhone: $('#sfParentPhone').value.trim(),
    });
    $('#studentFinanceModal').classList.add('hidden');
    toast('✅ تم حفظ بيانات الطالب', 'success');
    renderStudentsDirectory();
    if (currentPage === 'finance') renderFinancePage();
    if (currentPage === 'dashboard') renderDashboard();
  });
  $('#sfDeleteBtn').addEventListener('click', async () => {
    if (!editingStudentFinanceId) return;
    const ok = await askConfirm('حذف الطالب؟', 'سيتم حذف بيانات الطالب نهائياً.');
    if (ok) {
      await DB.deleteStudent(editingStudentFinanceId);
      $('#studentFinanceModal').classList.add('hidden');
      toast('🗑️ تم حذف الطالب');
      renderStudentsDirectory();
    }
  });
}

/* ==========================================================================
   Teachers Directory (admin)
   ========================================================================== */
function renderTeachersDirectory() {
  const teachers = DB.getTeachers();
  const grid = $('#teachersGrid');
  grid.innerHTML = '';
  $('#teachersEmpty').classList.toggle('hidden', teachers.length > 0);

  teachers.forEach(t => {
    const subject = DB.getSubjects().find(sub => sub.id === t.subject_id);
    const studentsCount = DB.getStudentsCountForTeacher(t.id);
    const groupsCount = DB.getGroupsByTeacher(t.id).length;
    const card = document.createElement('div');
    card.className = 'dir-card glass-panel tilt shine';
    card.innerHTML = `
      <div class="dir-card-head">
        <div class="dir-avatar">${initials(t.name)}</div>
        <div>
          <div class="dir-name">${escapeHtml(t.name)}</div>
          <div class="dir-role">${escapeHtml(subject?.name || 'بدون مادة')} · ${escapeHtml(t.grade_level || '—')} · ${escapeHtml(t.phone || '—')}</div>
        </div>
      </div>
      <div class="dir-stats-row">
        <div class="dir-stat"><b>${studentsCount}</b><span>طالب</span></div>
        <div class="dir-stat"><b>${groupsCount}</b><span>مجموعة</span></div>
        <div class="dir-stat"><b>${t.profit_percentage || 0}%</b><span>نسبة الربح</span></div>
      </div>
      <div class="dir-actions">
        <button class="ghost-btn" data-edit-teacher="${t.id}">✏️ تعديل</button>
        <button class="ghost-btn danger" data-delete-teacher="${t.id}">🗑️ حذف</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-edit-teacher]').forEach(btn => btn.addEventListener('click', () => openTeacherModal(btn.dataset.editTeacher)));
  grid.querySelectorAll('[data-delete-teacher]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف المدرس؟', 'سيتم حذف بيانات المدرس وحسابه المرتبط.');
    if (ok) { await DB.deleteTeacher(btn.dataset.deleteTeacher); toast('🗑️ تم حذف المدرس'); renderTeachersDirectory(); }
  }));
}
function fillSubjectSelect(selectEl, selectedId, gradeLevelId) {
  const subjects = gradeLevelId ? DB.getSubjectsByGradeLevel(gradeLevelId) : DB.getSubjects();
  selectEl.innerHTML = '<option value="">— اختر —</option>' + subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (selectedId) selectEl.value = selectedId;
}
function fillGradeLevelSelectDynamic(selectEl, selectedId) {
  const levels = DB.getGradeLevelRows();
  selectEl.innerHTML = '<option value="">— اختر —</option>' + levels.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  if (selectedId) selectEl.value = selectedId;
}
function openTeacherModal(teacherId) {
  editingTeacherId = teacherId || null;
  const t = teacherId ? DB.getTeacherById(teacherId) : null;
  $('#teacherModalTitle').textContent = t ? '✏️ تعديل بيانات المدرس' : '➕ إضافة مدرس جديد';
  $('#teacherName').value = t?.name || '';
  fillGradeLevelSelectDynamic($('#teacherGradeLevel'), t?.grade_level_id);
  fillSubjectSelect($('#teacherSubjectSelect'), t?.subject_id, t?.grade_level_id);
  $('#teacherSubjectSelect').disabled = !t?.grade_level_id;
  $('#teacherPhone').value = t?.phone || '';
  $('#teacherProfitPercentage').value = t?.profit_percentage ?? 50;
  const existingUser = t ? DB.getUsers().find(u => u.teacher_id === t.id) : null;
  $('#teacherUsername').value = existingUser?.username || '';
  $('#teacherPassword').value = existingUser?.password_hash || '';
  $('#teacherModal').classList.remove('hidden');
}
function initTeacherModal() {
  $('#addTeacherBtn').addEventListener('click', () => openTeacherModal(null));
  $('#teacherModalClose').addEventListener('click', () => $('#teacherModal').classList.add('hidden'));

  // سلسلة: اختيار السنة الدراسية أولاً، ثم تُفعَّل قائمة المواد الخاصة بها
  $('#teacherGradeLevel').addEventListener('change', () => {
    const gradeLevelId = $('#teacherGradeLevel').value;
    fillSubjectSelect($('#teacherSubjectSelect'), '', gradeLevelId);
    $('#teacherSubjectSelect').disabled = !gradeLevelId;
  });

  $('#saveTeacherBtn').addEventListener('click', async () => {
    const name = $('#teacherName').value.trim();
    const gradeLevelId = $('#teacherGradeLevel').value || null;
    const subjectId = $('#teacherSubjectSelect').value || null;
    const username = $('#teacherUsername').value.trim();
    const password = $('#teacherPassword').value.trim();

    if (!name) { toast('⚠️ من فضلك أدخل اسم المدرس', 'error'); return; }
    if (!gradeLevelId || !subjectId) { toast('⚠️ من فضلك اختر السنة الدراسية والمادة', 'error'); return; }
    // حساب الدخول إجباري لضمان امتلاك كل مدرس حساباً فعالاً
    if (!username || !password) { toast('⚠️ اسم المستخدم وكلمة المرور إجباريان لكل مدرس', 'error'); return; }

    const gradeLevel = DB.getGradeLevelById(gradeLevelId);
    const payload = {
      name, subjectId, gradeLevelId, gradeLevel: gradeLevel?.name || null,
      phone: $('#teacherPhone').value.trim(), profitPercentage: Number($('#teacherProfitPercentage').value) || 0,
    };

    let teacher;
    if (editingTeacherId) teacher = await DB.updateTeacher(editingTeacherId, payload);
    else teacher = await DB.addTeacher(payload);
    if (!teacher) { toast('⚠️ تعذر حفظ بيانات المدرس', 'error'); return; }

    const existing = DB.getUsers().find(u => u.teacher_id === teacher.id);
    if (existing) await DB.updateUser(existing.id, { username, password, name: teacher.name });
    else {
      const res = await DB.addUser({ username, password, role: 'teacher', name: teacher.name, teacherId: teacher.id });
      if (res && res.error) { toast('⚠️ اسم المستخدم مستخدم بالفعل', 'error'); return; }
    }
    $('#teacherModal').classList.add('hidden');
    toast('✅ تم حفظ بيانات المدرس وحساب الدخول', 'success');
    renderTeachersDirectory();
  });
}

/* ==========================================================================
   Groups page (admin)
   ========================================================================== */
/* ==========================================================================
   Groups page (admin) — مع دعم الإضافة والتعديل الكامل
   ========================================================================== */
function renderGroupsPage() {
  const groups = DB.getGroups();
  const grid = $('#groupsGrid');
  grid.innerHTML = '';
  $('#groupsEmpty').classList.toggle('hidden', groups.length > 0);

  groups.forEach(g => {
    const teacher = DB.getTeacherById(g.teacher_id);
    const subject = DB.getSubjects().find(s => s.id === g.subject_id);
    const studentsCount = DB.getStudentsByGroup(g.id).length;
    const card = document.createElement('div');
    card.className = 'dir-card glass-panel tilt shine';
    card.innerHTML = `
      <div class="dir-card-head">
        <div class="dir-avatar">${initials(teacher?.name || 'مج')}</div>
        <div>
          <div class="dir-name">${escapeHtml(g.grade_level || '—')}</div>
          <div class="dir-role">${escapeHtml(teacher?.name || 'بدون مدرس')} · ${escapeHtml(subject?.name || 'بدون مادة')}</div>
        </div>
      </div>
      <div class="group-meta-row">
        <span class="group-meta-pill">📅 ${escapeHtml(g.day_of_week || '—')}</span>
        <span class="group-meta-pill">⏰ ${escapeHtml(g.time_start || '—')}</span>
        <span class="group-meta-pill">💵 ${fmt(g.price_per_session)} ج/حصة</span>
      </div>
      <div class="dir-stats-row">
        <div class="dir-stat"><b>${studentsCount}</b><span>طالب مسجل</span></div>
      </div>
      <div class="dir-actions">
        <button class="ghost-btn" data-edit-group="${g.id}">✏️ تعديل المجموعة</button>
        <button class="ghost-btn danger" data-delete-group="${g.id}">🗑️ حذف</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-edit-group]').forEach(btn => {
    btn.addEventListener('click', () => openGroupModal(btn.dataset.editGroup));
  });

  grid.querySelectorAll('[data-delete-group]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف المجموعة؟', 'سيتم حذف المجموعة (الطلاب المسجلين بها لن يُحذفوا).');
    if (ok) { await DB.deleteGroup(btn.dataset.deleteGroup); toast('🗑️ تم حذف المجموعة'); renderGroupsPage(); }
  }));
}

function openGroupModal(groupId = null) {
  editingGroupId = groupId;
  const g = groupId ? DB.getGroupById(groupId) : null;
  
  const titleEl = $('#groupModal .panel-header h2');
  if (titleEl) titleEl.textContent = g ? '✏️ تعديل المجموعة' : '➕ إنشاء مجموعة جديدة';

  fillGradeLevelSelectDynamic($('#groupGradeLevel'), g?.grade_level_id);
  fillSubjectSelect($('#groupSubject'), g?.subject_id, g?.grade_level_id);
  fillGroupModalTeacherSelect();

  if (g?.teacher_id) $('#groupTeacher').value = g.teacher_id;
  $('#groupDayOfWeek').value = g?.day_of_week || 'السبت';
  $('#groupTimeStart').value = g?.time_start || '';
  $('#groupPricePerSession').value = g?.price_per_session ?? '';

  $('#groupModal').classList.remove('hidden');
}

function fillGroupModalTeacherSelect() {
  const sel = $('#groupTeacher');
  const teachers = DB.getTeachers();
  sel.innerHTML = '<option value="">— اختر —</option>' + teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

function initGroupModal() {
  $('#addGroupBtn').addEventListener('click', () => openGroupModal(null));
  $('#groupModalClose').addEventListener('click', () => $('#groupModal').classList.add('hidden'));

  $('#groupGradeLevel').addEventListener('change', () => {
    const gradeLevelId = $('#groupGradeLevel').value;
    fillSubjectSelect($('#groupSubject'), '', gradeLevelId);
  });

  $('#saveGroupBtn').addEventListener('click', async () => {
    const gradeLevelId = $('#groupGradeLevel').value;
    const gradeLevel = DB.getGradeLevelById(gradeLevelId);
    const subjectId = $('#groupSubject').value;
    const teacherId = $('#groupTeacher').value;
    const dayOfWeek = $('#groupDayOfWeek').value;
    const timeStart = $('#groupTimeStart').value;
    const pricePerSession = $('#groupPricePerSession').value;

    if (!gradeLevelId || !subjectId || !teacherId) {
      toast('⚠️ من فضلك أكمل اختيار المرحلة والمادة والمدرس', 'error');
      return;
    }

    const payload = {
      teacherId,
      subjectId,
      gradeLevel: gradeLevel?.name || '',
      gradeLevelId,
      dayOfWeek,
      timeStart,
      pricePerSession,
    };

    let group;
    if (editingGroupId) {
      group = await DB.updateGroup(editingGroupId, payload);
    } else {
      group = await DB.addGroup(payload);
    }

    if (!group) {
      toast('⚠️ تعذر حفظ بيانات المجموعة', 'error');
      return;
    }

    $('#groupModal').classList.add('hidden');
    toast(editingGroupId ? '✅ تم تعديل بيانات المجموعة بنجاح' : '✅ تم إنشاء المجموعة بنجاح', 'success');
    renderGroupsPage();
  });
}

/* ==========================================================================
   Grade Levels & Subjects page (admin)
   ========================================================================== */
let expandedGradeLevelId = null;
function renderGradeLevelsPage() {
  const levels = DB.getGradeLevelRows();
  const list = $('#gradeLevelsList');
  list.innerHTML = '';
  $('#gradeLevelsEmpty').classList.toggle('hidden', levels.length > 0);

  levels.forEach(level => {
    const subjects = DB.getSubjectsByGradeLevel(level.id);
    const card = document.createElement('div');
    card.className = 'dir-card glass-panel shine grade-level-card';
    card.innerHTML = `
      <div class="dir-card-head">
        <div class="dir-avatar">📘</div>
        <div>
          <div class="dir-name">${escapeHtml(level.name)}</div>
          <div class="dir-role">${subjects.length} مادة مرتبطة</div>
        </div>
      </div>
      <div class="subjects-chip-row" id="subjectsRow-${level.id}">
        ${subjects.map(s => `<span class="subject-chip">${escapeHtml(s.name)}<button data-delete-subject="${s.id}" title="حذف المادة">✕</button></span>`).join('') || '<span class="sub">لا توجد مواد بعد</span>'}
      </div>
      <div class="form-row grade-level-add-row">
        <input type="text" class="field" placeholder="اسم مادة جديدة" data-new-subject-name="${level.id}">
        <button class="ghost-btn" data-add-subject="${level.id}">➕ إضافة مادة</button>
      </div>
      <div class="dir-actions">
        <button class="ghost-btn danger" data-delete-grade="${level.id}">🗑️ حذف السنة الدراسية</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('[data-add-subject]').forEach(btn => btn.addEventListener('click', async () => {
    const levelId = btn.dataset.addSubject;
    const input = list.querySelector(`[data-new-subject-name="${levelId}"]`);
    const name = input.value.trim();
    if (!name) { toast('⚠️ أدخل اسم المادة', 'error'); return; }
    const res = await DB.addSubject({ name, gradeLevelId: levelId });
    if (res && res.error) { toast('⚠️ ' + res.error, 'error'); return; }
    toast('✅ تم إضافة المادة', 'success');
    renderGradeLevelsPage();
  }));
  list.querySelectorAll('[data-delete-subject]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف المادة؟', 'سيتم حذف المادة نهائياً.');
    if (ok) { await DB.deleteSubject(btn.dataset.deleteSubject); toast('🗑️ تم حذف المادة'); renderGradeLevelsPage(); }
  }));
  list.querySelectorAll('[data-delete-grade]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف السنة الدراسية؟', 'سيتم حذف السنة الدراسية وكل موادها المرتبطة.');
    if (ok) { await DB.deleteGradeLevel(btn.dataset.deleteGrade); toast('🗑️ تم حذف السنة الدراسية'); renderGradeLevelsPage(); }
  }));
}
function initGradeLevelsPage() {
  $('#addGradeLevelBtn').addEventListener('click', async () => {
    const input = $('#newGradeLevelName');
    const name = input.value.trim();
    if (!name) { toast('⚠️ أدخل اسم السنة الدراسية', 'error'); return; }
    const res = await DB.addGradeLevel({ name });
    if (res && res.error) { toast('⚠️ ' + res.error, 'error'); return; }
    input.value = '';
    toast('✅ تم إضافة السنة الدراسية', 'success');
    renderGradeLevelsPage();
  });
}

/* ==========================================================================
   Secretaries management page (admin)
   ========================================================================== */
let editingSecretaryId = null;
function renderSecretariesPage() {
  const secretaries = DB.getSecretaries();
  const grid = $('#secretariesGrid');
  grid.innerHTML = '';
  $('#secretariesEmpty').classList.toggle('hidden', secretaries.length > 0);

  secretaries.forEach(sec => {
    const card = document.createElement('div');
    card.className = 'dir-card glass-panel tilt shine';
    card.innerHTML = `
      <div class="dir-card-head">
        <div class="dir-avatar">${initials(sec.full_name || sec.username)}</div>
        <div>
          <div class="dir-name">${escapeHtml(sec.full_name || sec.username)}</div>
          <div class="dir-role">👤 ${escapeHtml(sec.username)} · ${escapeHtml(sec.phone || '—')}</div>
        </div>
      </div>
      <div class="dir-actions">
        <button class="ghost-btn" data-edit-secretary="${sec.id}">✏️ تعديل</button>
        <button class="ghost-btn danger" data-delete-secretary="${sec.id}">🗑️ حذف</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-edit-secretary]').forEach(btn => btn.addEventListener('click', () => openSecretaryModal(btn.dataset.editSecretary)));
  grid.querySelectorAll('[data-delete-secretary]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await askConfirm('حذف حساب السكرتير؟', 'سيتم حذف الحساب نهائياً ولن يستطيع الدخول بعد الآن.');
    if (ok) { await DB.deleteSecretary(btn.dataset.deleteSecretary); toast('🗑️ تم حذف الحساب'); renderSecretariesPage(); }
  }));
}
function openSecretaryModal(secretaryId) {
  editingSecretaryId = secretaryId || null;
  const sec = secretaryId ? DB.getUsers().find(u => String(u.id) === String(secretaryId)) : null;
  $('#secretaryModalTitle').textContent = sec ? '✏️ تعديل حساب سكرتير' : '➕ إضافة سكرتير جديد';
  $('#secretaryName').value = sec?.full_name || '';
  $('#secretaryUsername').value = sec?.username || '';
  $('#secretaryPassword').value = sec?.password_hash || '';
  $('#secretaryPhone').value = sec?.phone || '';
  $('#secretaryModal').classList.remove('hidden');
}
function initSecretariesPage() {
  $('#addSecretaryBtn').addEventListener('click', () => openSecretaryModal(null));
  $('#secretaryModalClose').addEventListener('click', () => $('#secretaryModal').classList.add('hidden'));
  $('#saveSecretaryBtn').addEventListener('click', async () => {
    const name = $('#secretaryName').value.trim();
    const username = $('#secretaryUsername').value.trim();
    const password = $('#secretaryPassword').value.trim();
    const phone = $('#secretaryPhone').value.trim();
    if (!name || !username || !password) { toast('⚠️ الاسم واسم المستخدم وكلمة المرور إجبارية', 'error'); return; }

    let res;
    if (editingSecretaryId) res = await DB.updateSecretary(editingSecretaryId, { username, password, name, phone });
    else res = await DB.addSecretary({ username, password, name, phone });
    if (res && res.error) { toast('⚠️ ' + res.error, 'error'); return; }

    $('#secretaryModal').classList.add('hidden');
    toast('✅ تم حفظ حساب السكرتير', 'success');
    renderSecretariesPage();
    renderDashboard();
  });
}

/* ==========================================================================
   Finance page (admin)
   ========================================================================== */
function renderFinanceFilterOptions() {
  const teacherSel = $('#finTeacherFilter');
  const groupSel = $('#finGroupFilter');
  const curTeacher = teacherSel.value || 'all';
  const curGroup = groupSel.value || 'all';

  teacherSel.innerHTML = '<option value="all">كل المدرسين</option>' +
    DB.getTeachers().map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  teacherSel.value = curTeacher;

  // المجموعات المعروضة تتبع المدرس المختار (لو محدد) لتسهيل التصفية المتقاطعة
  const groups = curTeacher !== 'all' ? DB.getGroupsByTeacher(curTeacher) : DB.getGroups();
  groupSel.innerHTML = '<option value="all">كل المجموعات</option>' + groups.map(g => {
    const teacher = DB.getTeacherById(g.teacher_id);
    const subject = DB.getSubjects().find(s => s.id === g.subject_id);
    const label = `${subject?.name || g.grade_level || 'مجموعة'} — ${teacher ? teacher.name : ''} — ${g.day_of_week || ''}`;
    return `<option value="${g.id}">${escapeHtml(label)}</option>`;
  }).join('');
  groupSel.value = curGroup;
}
function renderFinancePage() {
  renderFinanceFilterOptions();
  const fromDate = $('#finFromDate').value || null;
  const toDate = $('#finToDate').value || null;
  const teacherId = $('#finTeacherFilter').value || 'all';
  const groupId = $('#finGroupFilter').value || 'all';

  const fin = DB.getFinanceSummary(fromDate, toDate, teacherId, groupId);
  $('#finCollected').textContent = fmt(fin.totalCollected);
  $('#finExpenses').textContent = fmt(fin.totalExpenses);
  $('#finNet').textContent = fmt(fin.netProfit);
  $('#finOutstanding').textContent = fmt(fin.totalOutstanding);
  $('#finNetCard').classList.toggle('negative', fin.netProfit < 0);
  $('#finNetCard').classList.toggle('positive', fin.netProfit >= 0);

  const sBody = $('#finStudentsBody');
  sBody.innerHTML = DB.getStudents().map(s => `
    <tr><td><b>${escapeHtml(s.name)}</b></td><td>#${escapeHtml(s.student_code)}</td>
      <td>${escapeHtml(s.grade_level || '—')}</td><td>${debtBadgeHtml(s.total_debt)}</td></tr>
  `).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">لا يوجد طلاب</td></tr>`;

  const eBody = $('#expensesBody');
  eBody.innerHTML = DB.getExpenses().map(e => `<tr><td>${escapeHtml(e.name)}</td><td>${fmt(e.amount)}</td><td>${escapeHtml(e.note || '—')}</td>
      <td><button class="row-action-btn" data-delete-expense="${e.id}" title="حذف">🗑️</button></td></tr>`).join('')
      || `<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">لا توجد مصروفات</td></tr>`;
  eBody.querySelectorAll('[data-delete-expense]').forEach(btn => btn.addEventListener('click', async () => {
    await DB.deleteExpense(btn.dataset.deleteExpense);
    toast('🗑️ تم حذف البند');
    renderFinancePage();
  }));

  // سجل الدفعات التفصيلي — كل دفعة، توقيتها، ومن استلمها من السكرتارية، مفلترة حسب المدرس/المجموعة/التاريخ
  const ledger = DB.getPaymentLedgerRows(fromDate, toDate, teacherId, groupId);
  const pBody = $('#paymentsLedgerBody');
  if (pBody) {
    $('#paymentsLedgerEmpty').classList.toggle('hidden', ledger.length > 0);
    pBody.innerHTML = ledger.map(p => `
      <tr>
        <td>${escapeHtml(p.date)}</td><td>${escapeHtml(p.time)}</td>
        <td><b>${escapeHtml(p.studentName)}</b></td><td>#${escapeHtml(p.studentCode)}</td>
        <td>${fmt(p.amount)} ج</td><td>${escapeHtml(p.secretaryName)}</td><td>${escapeHtml(p.notes || '—')}</td>
      </tr>
    `).join('');
  }

  // ترويسة الطباعة: تلخّص الفلاتر النشطة عند الطباعة فقط
  const teacherLabel = teacherId !== 'all' ? (DB.getTeacherById(teacherId)?.name || '') : 'كل المدرسين';
  const groupLabel = groupId !== 'all' ? ($('#finGroupFilter').selectedOptions[0]?.textContent || '') : 'كل المجموعات';
  $('#financePrintHeader').textContent =
    `تقرير مالي — ${DB.getCenterInfo().nameAr} | المدرس: ${teacherLabel} | المجموعة: ${groupLabel} | من ${fromDate || '—'} إلى ${toDate || '—'}`;
}
function initExpenseModal() {
  $('#addExpenseBtn').addEventListener('click', () => {
    $('#expenseName').value = ''; $('#expenseAmount').value = ''; $('#expenseNote').value = '';
    $('#expenseModal').classList.remove('hidden');
  });
  $('#expenseModalClose').addEventListener('click', () => $('#expenseModal').classList.add('hidden'));
  $('#saveExpenseBtn').addEventListener('click', async () => {
    const name = $('#expenseName').value.trim();
    if (!name) { toast('⚠️ أدخل اسم البند', 'error'); return; }
    await DB.addExpense({ name, amount: $('#expenseAmount').value, note: $('#expenseNote').value.trim() });
    $('#expenseModal').classList.add('hidden');
    toast('✅ تم إضافة المصروف', 'success');
    renderFinancePage();
  });
}
function initFinanceFilters() {
  $('#finFilterBtn').addEventListener('click', renderFinancePage);
  $('#exportPdfBtn').addEventListener('click', exportFinancePdf);
  $('#finTeacherFilter').addEventListener('change', () => { renderFinanceFilterOptions(); renderFinancePage(); });
  $('#finGroupFilter').addEventListener('change', renderFinancePage);
  $('#finPrintBtn').addEventListener('click', printFinanceReport);
}
/* طباعة نظيفة لجدول الماليات المفلتر فقط مع إحصائياته — تُخفي كل شيء آخر أثناء الطباعة */
function printFinanceReport() {
  document.body.classList.add('printing-finance');
  const cleanup = () => document.body.classList.remove('printing-finance');
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => { window.print(); setTimeout(cleanup, 500); }, 80);
}
function exportFinancePdf() {
  if (!window.jspdf) { toast('⚠️ مكتبة تصدير PDF لم تُحمَّل بعد، حاول مرة أخرى', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const fromDate = $('#finFromDate').value || '—';
  const toDate = $('#finToDate').value || '—';
  const teacherId = $('#finTeacherFilter').value || 'all';
  const groupId = $('#finGroupFilter').value || 'all';
  const fin = DB.getFinanceSummary($('#finFromDate').value || null, $('#finToDate').value || null, teacherId, groupId);

  doc.setFontSize(16);
  doc.text('ATEF CENTER - Financial Report', 14, 16);
  doc.setFontSize(10);
  doc.text(`Period: ${fromDate}  to  ${toDate}`, 14, 24);
  doc.text(`Total Collected: ${fin.totalCollected}   Expenses: ${fin.totalExpenses}   Net: ${fin.netProfit}   Outstanding: ${fin.totalOutstanding}`, 14, 30);

  const rows = DB.getStudents().map(s => [s.student_code, s.name, s.grade_level || '-', String(s.total_debt || 0)]);
  doc.autoTable({
    head: [['Code', 'Name', 'Grade', 'Debt']],
    body: rows,
    startY: 36,
    styles: { font: 'helvetica', fontSize: 9 },
  });

  doc.save(`atef-finance-report-${todayIso()}.pdf`);
  toast('✅ تم تصدير التقرير PDF', 'success');
}
function todayIso() { return new Date().toISOString().slice(0, 10); }

/* ==========================================================================
   Master table (admin)
   ========================================================================== */
function renderMasterTable() {
  const fromDate = $('#masterFromDate').value || null;
  const toDate = $('#masterToDate').value || null;
  const rows = DB.getMasterTableRows(fromDate, toDate);
  const body = $('#masterBody');
  $('#masterEmpty').classList.toggle('hidden', rows.length > 0);
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.date)}</td><td>#${escapeHtml(r.studentCode)}</td><td>${escapeHtml(r.studentName)}</td>
      <td>${escapeHtml(r.gradeLevel)}</td><td>${escapeHtml(r.teacherName)}</td><td>${escapeHtml(r.timeIn)}</td>
      <td>${escapeHtml(r.attendance)}</td><td>${fmt(r.amountPaid)}</td><td>${escapeHtml(r.homework)}</td>
      <td>${escapeHtml(r.exam)}</td><td>${escapeHtml(r.notes || '—')}</td><td>${escapeHtml(r.approved)}</td>
      <td>${fmt(r.totalDebt)}</td>
    </tr>
  `).join('');
}
function initMasterTable() {
  $('#masterFilterBtn').addEventListener('click', renderMasterTable);
  $('#exportMasterExcelBtn').addEventListener('click', exportMasterExcel);
}
function exportMasterExcel() {
  if (!window.XLSX) { toast('⚠️ مكتبة تصدير Excel لم تُحمَّل بعد، حاول مرة أخرى', 'error'); return; }
  const fromDate = $('#masterFromDate').value || null;
  const toDate = $('#masterToDate').value || null;
  const rows = DB.getMasterTableRows(fromDate, toDate).map(r => ({
    'التاريخ': r.date, 'كود الطالب': r.studentCode, 'الاسم': r.studentName, 'الصف': r.gradeLevel,
    'المدرس': r.teacherName, 'وقت الحضور': r.timeIn, 'الحضور': r.attendance, 'المدفوع': r.amountPaid,
    'الواجب': r.homework, 'الامتحان': r.exam, 'ملاحظات': r.notes, 'معتمد': r.approved, 'المديونية الحالية': r.totalDebt,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Master Sheet');
  XLSX.writeFile(wb, `atef-master-sheet-${todayIso()}.xlsx`);
  toast('✅ تم تصدير الشيت المجمع', 'success');
}

/* ==========================================================================
   Settings page
   ========================================================================== */
function renderSettingsPage() {
  const info = DB.getCenterInfo();
  $('#settingCenterNameAr').value = info.nameAr;
  $('#settingCenterNameEn').value = info.nameEn;
  const status = $('#dbConnectionStatus');
  status.textContent = DB.client ? '✅ متصل بمشروع Supabase (تحقق من صحة الـ URL والمفتاح إن ظهرت أخطاء)' : '⚠️ لم يتم تهيئة الاتصال';
}
function initSettingsPage() {
  $('#saveCenterInfoBtn').addEventListener('click', () => {
    DB.updateCenterInfo({ nameAr: $('#settingCenterNameAr').value.trim(), nameEn: $('#settingCenterNameEn').value.trim() });
    applyCenterBranding();
    toast('✅ تم حفظ بيانات السنتر', 'success');
  });
  $('#settingsThemeBtn').addEventListener('click', toggleTheme);
}

/* ==========================================================================
   Reception (secretary) view
   ========================================================================== */
function renderGroupChips() {
  const container = $('#groupChips');
  const gradeLevels = DB.getGradeLevels();
  container.innerHTML = '<button class="chip active" data-group="all">الكل</button>' +
    gradeLevels.map(g => `<button class="chip" data-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('');
  container.querySelectorAll('.chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.group === activeGroupFilter);
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeGroupFilter = chip.dataset.group;
      flashCardStudentId = null;
      renderStudentsList();
    });
  });
}
function groupColor(seedStr) {
  const palette = ['#cdd1d8', '#b3b8c2', '#9aa0ac', '#8f96a3', '#a9aeb8', '#7d8797'];
  let hash = 0;
  for (const ch of (seedStr || '')) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return palette[hash % palette.length];
}
function statusOf(studentId) {
  if (DB.getApprovedRecordForStudentToday(studentId)) return { cls: 'approved', label: 'مُعتمد ✅' };
  if (DB.getPendingRecordForStudentToday(studentId)) return { cls: 'pending', label: 'بانتظار الاعتماد' };
  return { cls: '', label: 'لم يُسجَّل بعد' };
}
function renderStudentsList(filterOverride) {
  const searchTerm = (filterOverride ?? $('#studentSearch').value ?? '').trim().toLowerCase();
  const list = $('#studentsList');
  let students = DB.getStudents();

  if (flashCardStudentId) {
    // وضع الـ Flash Card (من قارئ الباركود الخارجي) — نعرض كارت هذا الطالب فقط
    const only = DB.getStudentById(flashCardStudentId);
    students = only ? [only] : [];
  } else {
    if (activeGroupFilter !== 'all') students = students.filter(s => s.grade_level === activeGroupFilter);
    if (searchTerm) students = students.filter(s => s.name.toLowerCase().includes(searchTerm) || String(s.student_code).toLowerCase().includes(searchTerm));
  }

  list.innerHTML = '';
  $('#noResults').classList.toggle('hidden', students.length > 0);
  $('#pendingCountSecretary').textContent = DB.getPendingRecords().length;

  const template = $('#studentCardTemplate');
  const todayName = DB.getTodayDayName();
  students.forEach(student => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.student-card');
    card.dataset.id = student.id;
    card.style.setProperty('--group-color', groupColor(student.grade_level));

    node.querySelector('.avatar-orb').textContent = initials(student.name);
    node.querySelector('.s-name').textContent = student.name;
    node.querySelector('.s-id').textContent = student.student_code;
    node.querySelector('.tag-group').textContent = student.grade_level || '—';

    const debtBox = node.querySelector('[data-role="debtBox"]');
    const debtAmount = node.querySelector('[data-role="debtAmount"]');
    const debt = Number(student.total_debt) || 0;
    debtAmount.textContent = fmt(debt);
    debtBox.classList.toggle('zero-debt', debt <= 0);

    // تفصيل المديونية: كل حصة سابقة لم تُدفع بالكامل (تاريخ - مجموعة - متبقي)
    const debtDetailsWrap = node.querySelector('[data-role="debtDetailsWrap"]');
    const debtDetailsBody = node.querySelector('[data-role="debtDetailsBody"]');
    const debtRows = DB.getDebtDetailsForStudent(student.id);
    if (debtRows.length) {
      debtDetailsWrap.classList.remove('hidden');
      debtDetailsBody.innerHTML = debtRows.map(row => `
        <tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.groupLabel)}</td><td>${fmt(row.remaining)} ج</td></tr>
      `).join('');
    } else {
      debtDetailsWrap.classList.add('hidden');
      debtDetailsBody.innerHTML = '';
    }

    const status = statusOf(student.id);
    const pill = node.querySelector('[data-role="statusPill"]');
    pill.textContent = status.label;
    pill.className = `status-chip ${status.cls}`.trim();

    // فلترة مجاميع اليوم فقط: لو مادة واحدة تُختار تلقائياً، لو أكثر تظهر كقائمة منسدلة، لو ولا مجموعة تظهر رسالة تنبيه
    node.querySelector('[data-role="todayDayLabel"]').textContent = todayName;
    const groupSelect = node.querySelector('[data-field="todayGroup"]');
    const noGroupNote = node.querySelector('[data-role="noGroupTodayNote"]');
    const todaysGroups = DB.getGroupsForStudentToday(student.id);
    if (todaysGroups.length) {
      groupSelect.innerHTML = todaysGroups.map(g => {
        const teacher = DB.getTeacherById(g.teacher_id);
        const subject = DB.getSubjects().find(s => s.id === g.subject_id);
        const label = `${subject?.name || g.grade_level || 'مجموعة'} — ${teacher ? teacher.name : ''}`.trim();
        return `<option value="${g.id}" data-price="${g.price_per_session || 0}">${escapeHtml(label)}</option>`;
      }).join('');
      groupSelect.disabled = todaysGroups.length === 1;
      noGroupNote.classList.add('hidden');
    } else {
      groupSelect.innerHTML = '<option value="">— لا توجد مجموعة اليوم —</option>';
      groupSelect.disabled = true;
      noGroupNote.classList.remove('hidden');
    }

    const paidInput = node.querySelector('[data-field="paidNow"]');
    const remainingInput = node.querySelector('[data-field="remainingAmount"]');
    const presentCheck = node.querySelector('[data-field="presentCheck"]');
    const recalcRemaining = () => {
      const selectedOpt = groupSelect.options[groupSelect.selectedIndex];
      const price = Number(selectedOpt?.dataset.price) || 0;
      const paid = Number(paidInput.value) || 0;
      remainingInput.value = price - paid;
    };
    groupSelect.addEventListener('change', recalcRemaining);
    paidInput.addEventListener('input', recalcRemaining);

    const timeChip = node.querySelector('[data-role="timeInChip"]');
    // يبحث عن سجل اليوم بحسب المجموعة المختارة حالياً (أول مجموعة اليوم افتراضياً)
    const defaultGroupId = todaysGroups[0]?.id || null;
    const existing = DB.getPendingRecordForStudentToday(student.id, defaultGroupId) || DB.getApprovedRecordForStudentToday(student.id, defaultGroupId);
    if (existing) {
      if (existing.group_id) groupSelect.value = existing.group_id;
      if (existing.amount_paid) paidInput.value = existing.amount_paid;
      presentCheck.checked = existing.attendance === 'present';
      if (existing.time_in && existing.attendance === 'present') {
        timeChip.textContent = `⏱ وقت الحضور: ${existing.time_in}`;
        timeChip.classList.add('recorded');
      }
    }
    recalcRemaining(); // تعيين "المبلغ المتبقي" الافتراضي = سعر حصة المجموعة المختارة

    list.appendChild(node);
  });
}
function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initStudentsListDelegation() {
  $('#studentsList').addEventListener('click', async (e) => {
    const card = e.target.closest('.student-card');
    if (!card) return;
    const studentId = card.dataset.id;
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;

    if (action === 'save') {
      await saveCardRecord(card, studentId);
    }
  });

  $('#studentSearch').addEventListener('input', () => {
    flashCardStudentId = null; // أي كتابة يدوية جديدة تُخرج من وضع الـ Flash Card وترجع للقائمة الكاملة
    renderStudentsList();
    $('#clearSearchBtn').classList.toggle('hidden', !$('#studentSearch').value);
  });
  $('#clearSearchBtn').addEventListener('click', () => {
    $('#studentSearch').value = '';
    $('#clearSearchBtn').classList.add('hidden');
    flashCardStudentId = null;
    renderStudentsList();
  });

  /* دعم جهاز الباركود الخارجي: يكتب الكود بسرعة ثم يضغط Enter تلقائياً.
     عند رصد Enter نبحث عن الكود المطابق تماماً ونفتح كارت هذا الطالب فقط (Flash Card). */
  $('#studentSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = $('#studentSearch').value.trim();
    if (!code) return;
    const student = DB.getStudentByCode(code) || DB.getStudentById(code);
    if (!student) { toast('⚠️ كود الطالب غير موجود', 'error'); return; }
    flashCardStudentId = student.id;
    renderStudentsList();
    toast(`🔎 تم فتح كارت: ${student.name}`, 'success');
  });
}
/* زر "💾 حفظ البيانات" الموحد — يرسل الحضور (من الـ Checkbox) والدفعة معاً دفعة واحدة
   لتنفيذ UPSERT على المفتاح المركب (student_id, group_id, session_date) داخل db.js */
async function saveCardRecord(card, studentId) {
  const groupId = card.querySelector('[data-field="todayGroup"]').value || null;
  if (!groupId) { toast('⚠️ الطالب غير مسجل بأي مجموعة تُقام اليوم، لا يمكن الحفظ', 'error'); return; }

  const isPresent = card.querySelector('[data-field="presentCheck"]').checked;
  const paidNow = Number(card.querySelector('[data-field="paidNow"]').value) || 0;
  const paymentStatus = paidNow > 0 ? 'paid' : 'unpaid';

  const record = await DB.saveRecord({
    studentId,
    groupId,
    attendance: isPresent ? 'present' : 'absent',
    paymentStatus,
    amountPaid: paidNow,
    secretaryId: session?.id || null,
    secretaryName: session?.full_name || 'الاستقبال',
  });
  if (!record) { toast('⚠️ تعذر حفظ البيانات', 'error'); return; }

  toast('✅ تم حفظ البيانات — بانتظار اعتماد الإدارة', 'success');
  refreshSideBadge();
  if (currentPage === 'finance') renderFinancePage();
  renderStudentsList();
}

/* ==========================================================================
   QR flip card: build, render, print
   ========================================================================== */
function buildFlipCardHtml(student) {
  const info = DB.getCenterInfo();
  return `
    <div class="flip-card printable-card" id="flipCard-${student.id}">
      <div class="flip-inner">
        <div class="flip-front">
          <div class="fc-top">
            <span class="fc-brand">${escapeHtml(info.nameEn)}<br>${escapeHtml(info.nameAr)}</span>
            <span class="fc-chip"></span>
          </div>
          <div class="fc-bottom">
            <p class="fc-name">${escapeHtml(student.name)}</p>
            <p class="fc-id">كود الطالب: ${escapeHtml(student.student_code)}</p>
            <p class="fc-group">${escapeHtml(student.grade_level || '')}</p>
          </div>
        </div>
        <div class="flip-back" id="qrHolder-${student.id}"></div>
      </div>
    </div>`;
}
function renderQrIntoHolder(student) {
  const holder = document.getElementById(`qrHolder-${student.id}`);
  if (!holder) return;
  if (window.QRCode) {
    QRCode.toCanvas(document.createElement('canvas'), `STUDENT:${student.student_code}`, { width: 128, margin: 0 }, (err, canvas) => {
      if (!err) holder.appendChild(canvas); else holder.textContent = student.student_code;
    });
  } else {
    holder.textContent = student.student_code;
  }
}
function initFlipCards() {
  document.addEventListener('click', (e) => {
    const flip = e.target.closest('.flip-card');
    if (flip) flip.classList.toggle('flipped');
  });
}
function openQrViewModal(studentId) {
  const student = DB.getStudentById(studentId);
  if (!student) return;
  $('#qrViewCardPreview').innerHTML = buildFlipCardHtml(student);
  renderQrIntoHolder(student);
  $('#qrViewModal').classList.remove('hidden');
}
function openPrintForStudent(studentId) {
  openQrViewModal(studentId);
  const flip = $('#qrViewCardPreview .flip-card');
  if (flip) flip.classList.add('flipped');
  setTimeout(() => window.print(), 300);
}

/* ---------------- Add student flow (cascading selects — 100% dynamic) ---------------- */
function initCascadingStudentSelects() {
  const gradeSel = $('#newStudentGradeLevel');
  const subjectSel = $('#newStudentSubject');
  const teacherSel = $('#newStudentTeacherSelect');
  const groupSel = $('#newStudentGroupSelect');

  // المرحلة الدراسية تُسحب ديناميكياً من grade_levels، ثم موادها من subjects المرتبطة بها
  gradeSel.addEventListener('change', () => {
    const gradeLevelId = gradeSel.value;
    const gradeLevel = DB.getGradeLevelById(gradeLevelId);
    subjectSel.innerHTML = '<option value="">— اختر —</option>';
    teacherSel.innerHTML = '<option value="">— اختر المادة أولاً —</option>';
    groupSel.innerHTML = '<option value="">— اختر المعلم أولاً —</option>';
    subjectSel.disabled = !gradeLevelId; teacherSel.disabled = true; groupSel.disabled = true;
    if (!gradeLevelId) return;
    const subjects = DB.getSubjectsByGradeLevel(gradeLevelId);
    subjectSel.innerHTML = '<option value="">— اختر —</option>' + subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    subjectSel.dataset.gradeLevelName = gradeLevel?.name || '';
  });

  subjectSel.addEventListener('change', () => {
    const gradeLevelName = subjectSel.dataset.gradeLevelName || '';
    const subjectId = subjectSel.value;
    teacherSel.innerHTML = '<option value="">— اختر —</option>';
    groupSel.innerHTML = '<option value="">— اختر المعلم أولاً —</option>';
    teacherSel.disabled = !subjectId; groupSel.disabled = true;
    if (!subjectId) return;
    const matching = DB.getGroupsByGradeLevel(gradeLevelName).filter(g => String(g.subject_id) === String(subjectId));
    const teacherIds = [...new Set(matching.map(g => g.teacher_id))];
    const teachers = DB.getTeachers().filter(t => teacherIds.includes(t.id));
    teacherSel.innerHTML = '<option value="">— اختر —</option>' + teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  });

  teacherSel.addEventListener('change', () => {
    const gradeLevelName = subjectSel.dataset.gradeLevelName || '';
    const subjectId = subjectSel.value;
    const teacherId = teacherSel.value;
    groupSel.innerHTML = '<option value="">— اختر —</option>';
    groupSel.disabled = !teacherId;
    if (!teacherId) return;
    const matching = DB.getGroupsByGradeLevel(gradeLevelName).filter(g => String(g.subject_id) === String(subjectId) && String(g.teacher_id) === String(teacherId));
    groupSel.innerHTML = '<option value="">— اختر —</option>' + matching.map(g => `<option value="${g.id}">${escapeHtml(g.day_of_week || '')} ${escapeHtml(g.time_start || '')}</option>`).join('');
  });
}
function resetCascadingStudentSelects() {
  fillGradeLevelSelectDynamic($('#newStudentGradeLevel'));
  $('#newStudentSubject').innerHTML = '<option value="">— اختر المرحلة أولاً —</option>';
  $('#newStudentTeacherSelect').innerHTML = '<option value="">— اختر المادة أولاً —</option>';
  $('#newStudentGroupSelect').innerHTML = '<option value="">— اختر المعلم أولاً —</option>';
  $('#newStudentSubject').disabled = true;
  $('#newStudentTeacherSelect').disabled = true;
  $('#newStudentGroupSelect').disabled = true;
}
/* عرض سلة (Cart) المواد المُضافة للطالب الجديد قبل الحفظ — تعدد المواد */
function renderAddStudentGroupsCart() {
  const container = $('#newStudentGroupsCart');
  container.innerHTML = addStudentGroupsCart.length
    ? addStudentGroupsCart.map((c, idx) => `<span class="subject-chip">${escapeHtml(c.label)}<button data-remove-cart-idx="${idx}" title="إزالة">✕</button></span>`).join('')
    : '<span class="sub">لم تُضَف أي مادة بعد</span>';
  container.querySelectorAll('[data-remove-cart-idx]').forEach(btn => btn.addEventListener('click', () => {
    addStudentGroupsCart.splice(Number(btn.dataset.removeCartIdx), 1);
    renderAddStudentGroupsCart();
  }));
}
function groupCartLabel(groupId) {
  const group = DB.getGroupById(groupId);
  if (!group) return 'مادة';
  const teacher = DB.getTeacherById(group.teacher_id);
  const subject = DB.getSubjects().find(s => s.id === group.subject_id);
  return `${subject?.name || group.grade_level || 'مادة'} — ${teacher ? teacher.name : ''}`.trim();
}
function initAddStudentModal() {
  const openBtn = () => {
    resetAddStudentModal();
    resetCascadingStudentSelects();
    addStudentGroupsCart = [];
    renderAddStudentGroupsCart();
    $('#addStudentModal').classList.remove('hidden');
  };
  $('#addStudentBtn')?.addEventListener('click', openBtn);
  $('#addStudentBtn2')?.addEventListener('click', openBtn);
  $('#addStudentModalClose').addEventListener('click', () => $('#addStudentModal').classList.add('hidden'));

  // نظام السلة (Cart): يختار الأدمن سنة → مادة → مدرس → مجموعة، ثم يضغط "➕ إضافة مادة" فتظهر Chip
  $('#addGroupToCartBtn').addEventListener('click', () => {
    const groupId = $('#newStudentGroupSelect').value;
    if (!groupId) { toast('⚠️ من فضلك أكمل اختيار المرحلة/المادة/المدرس/المجموعة أولاً', 'error'); return; }
    if (addStudentGroupsCart.some(c => String(c.groupId) === String(groupId))) { toast('⚠️ تمت إضافة هذه المادة بالفعل', 'error'); return; }
    addStudentGroupsCart.push({ groupId, label: groupCartLabel(groupId) });
    renderAddStudentGroupsCart();
    toast('✅ تمت إضافة المادة للسلة', 'success');
  });

  $('#createStudentBtn').addEventListener('click', async () => {
    const studentCode = $('#newStudentCode').value.trim();
    const name = $('#newStudentName').value.trim();
    const gradeLevelId = $('#newStudentGradeLevel').value;
    const gradeLevel = gradeLevelId ? DB.getGradeLevelById(gradeLevelId)?.name : '';

    const phone = $('#newStudentPhone').value.trim();
    const parentPhone = $('#newStudentParentPhone').value.trim();
    if (!studentCode || !name) { toast('⚠️ من فضلك أدخل كود الطالب والاسم على الأقل', 'error'); return; }

    if (DB.getStudentByCode(studentCode)) { toast('⚠️ كود الطالب مستخدم بالفعل، اختر كوداً آخر', 'error'); return; }

    // لو الأدمن اختار مجموعة ولم يضغط "إضافة مادة"، نضيفها تلقائياً للسلة كتسهيل
    const lastSelectedGroup = $('#newStudentGroupSelect').value;
    if (lastSelectedGroup && !addStudentGroupsCart.some(c => String(c.groupId) === String(lastSelectedGroup))) {
      addStudentGroupsCart.push({ groupId: lastSelectedGroup, label: groupCartLabel(lastSelectedGroup) });
    }
    const groupIds = addStudentGroupsCart.map(c => c.groupId);

    const student = await DB.addStudent({ studentCode, name, gradeLevel, phone, parentPhone, groupIds });
    if (student && student.error) { toast('⚠️ تعذر إنشاء الطالب: ' + student.error, 'error'); return; }

    $('#addStudentFormStep').classList.add('hidden');
    $('#addStudentQrStep').classList.remove('hidden');
    $('#qrCardPreview').innerHTML = buildFlipCardHtml(student);
    renderQrIntoHolder(student);
    $('#createStudentBtn').classList.add('hidden');
    $('#printNewQrCardBtn').classList.remove('hidden');
    $('#addAnotherStudentBtn').classList.remove('hidden');

    if ($('#groupChips')) renderGroupChips();
    if (currentPage === 'reception') renderStudentsList();
    if (currentPage === 'students') renderStudentsDirectory();
    toast(`🎉 تم إنشاء الطالب "${student.name}" بالكود ${student.student_code} في ${groupIds.length} مادة`, 'success');
  });

  $('#printNewQrCardBtn').addEventListener('click', () => {
    const flip = $('#qrCardPreview .flip-card');
    if (flip) flip.classList.add('flipped');
    setTimeout(() => window.print(), 250);
  });
  $('#addAnotherStudentBtn').addEventListener('click', () => {
    resetAddStudentModal();
    resetCascadingStudentSelects();
    addStudentGroupsCart = [];
    renderAddStudentGroupsCart();
  });
}
function resetAddStudentModal() {
  $('#newStudentCode').value = '';
  $('#newStudentName').value = '';
  $('#newStudentPhone').value = '';
  $('#newStudentParentPhone').value = '';
  $('#addStudentFormStep').classList.remove('hidden');
  $('#addStudentQrStep').classList.add('hidden');
  $('#createStudentBtn').classList.remove('hidden');
  $('#printNewQrCardBtn').classList.add('hidden');
  $('#addAnotherStudentBtn').classList.add('hidden');
}

/* ---------------- Scanner (auto-detect → instant attendance) ---------------- */
function initScanner() {
  $('#scanQrBtn').addEventListener('click', async () => {
    scannerBusy = false;
    $('#scannerResult').classList.add('hidden');
    $('#scannerModal').classList.remove('hidden');
    if (!window.Html5Qrcode) { toast('⚠️ تعذر تحميل مكتبة المسح، تحقق من الاتصال', 'error'); return; }
    try {
      html5QrInstance = new Html5Qrcode('qrReaderRegion');
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras.length) { toast('⚠️ لم يتم العثور على كاميرا', 'error'); return; }
      await html5QrInstance.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, onScanSuccess, () => {});
    } catch (err) {
      toast('⚠️ تعذر تشغيل الكاميرا — تحقق من الأذونات', 'error');
    }
  });
  $('#scannerModalClose').addEventListener('click', stopScanner);
}
function stopScanner() {
  $('#scannerModal').classList.add('hidden');
  if (html5QrInstance) { html5QrInstance.stop().then(() => html5QrInstance.clear()).catch(() => {}); html5QrInstance = null; }
  scannerBusy = false;
}
async function onScanSuccess(decodedText) {
  if (scannerBusy) return; // منع القراءات المتكررة السريعة لنفس الكود
  scannerBusy = true;
  const code = decodedText.replace('STUDENT:', '').trim();
  const student = DB.getStudentByCode(code) || DB.getStudentById(code);
  stopScanner();
  if (!student) { toast('⚠️ الكود غير معروف', 'error'); return; }

  // فتح كارت الطالب فقط (Flash Card) — الكارت يفلتر تلقائياً مجاميع اليوم:
  // مادة واحدة تُختار تلقائياً، أكثر من مادة تظهر كقائمة ليختار منها السكرتير، ثم يضغط "حفظ البيانات"
  $('#studentSearch').value = student.student_code;
  flashCardStudentId = student.id;
  renderStudentsList();
  toast(`🔎 تم فتح كارت: ${student.name}`, 'success');
}

/* ==========================================================================
   Teacher Portal — cascading grade → group → students table
   ========================================================================== */
function renderTeacherPortalRoot() {
  if (!session || session.role !== 'teacher') return;
  const gradeSel = $('#teacherGradeLevelSelect');
  const teacher = DB.getTeacherById(session.teacher_id);
  const myGroups = teacher ? DB.getGroupsByTeacher(teacher.id) : [];
  const grades = [...new Set(myGroups.map(g => g.grade_level).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  gradeSel.innerHTML = '<option value="">— اختر المرحلة —</option>' + grades.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  $('#teacherGroupSelect').innerHTML = '<option value="">— اختر المجموعة —</option>';
  $('#teacherGroupSelect').disabled = true;
  $('#teacherStudentsList').innerHTML = '';
  $('#teacherNoResults').classList.remove('hidden');
  $('#teacherSubmitAllBtn').classList.add('hidden');
}
function initTeacherCascadingSelects() {
  $('#teacherGradeLevelSelect').addEventListener('change', () => {
    const grade = $('#teacherGradeLevelSelect').value;
    const groupSel = $('#teacherGroupSelect');
    groupSel.innerHTML = '<option value="">— اختر المجموعة —</option>';
    groupSel.disabled = !grade;
    $('#teacherStudentsList').innerHTML = '';
    $('#teacherNoResults').classList.remove('hidden');
    $('#teacherSubmitAllBtn').classList.add('hidden');
    if (!grade) return;
    const teacher = DB.getTeacherById(session.teacher_id);
    const groups = DB.getGroupsByTeacher(teacher.id).filter(g => g.grade_level === grade);
    groupSel.innerHTML = '<option value="">— اختر المجموعة —</option>' + groups.map(g => {
      const subject = DB.getSubjects().find(s => s.id === g.subject_id);
      return `<option value="${g.id}">${escapeHtml(subject?.name || 'مجموعة')} — ${escapeHtml(g.day_of_week || '')} ${escapeHtml(g.time_start || '')}</option>`;
    }).join('');
  });
  $('#teacherGroupSelect').addEventListener('change', () => {
    const groupId = $('#teacherGroupSelect').value;
    $('#teacherStudentSearch').value = '';
    $('#teacherClearSearchBtn').classList.add('hidden');
    if (!groupId) {
      teacherCurrentGroupId = null;
      $('#teacherStudentsList').innerHTML = '';
      $('#teacherNoResults').classList.remove('hidden');
      $('#teacherSubmitAllBtn').classList.add('hidden');
      return;
    }
    renderTeacherStudentsList(groupId);
  });
}
/* بحث السكرتير/المدرس داخل المجموعة المعروضة حالياً — بالاسم أو الكود */
function initTeacherSearch() {
  $('#teacherStudentSearch').addEventListener('input', () => {
    $('#teacherClearSearchBtn').classList.toggle('hidden', !$('#teacherStudentSearch').value);
    if (teacherCurrentGroupId) renderTeacherStudentsList(teacherCurrentGroupId);
  });
  $('#teacherClearSearchBtn').addEventListener('click', () => {
    $('#teacherStudentSearch').value = '';
    $('#teacherClearSearchBtn').classList.add('hidden');
    if (teacherCurrentGroupId) renderTeacherStudentsList(teacherCurrentGroupId);
  });
}
let teacherCurrentGroupId = null;
function renderTeacherStudentsList(groupId) {
  teacherCurrentGroupId = groupId;
  const list = $('#teacherStudentsList');
  let students = DB.getStudentsByGroup(groupId);
  const searchTerm = ($('#teacherStudentSearch')?.value || '').trim().toLowerCase();
  if (searchTerm) {
    students = students.filter(s => s.name.toLowerCase().includes(searchTerm) || String(s.student_code).toLowerCase().includes(searchTerm));
  }
  list.innerHTML = '';
  $('#teacherNoResults').classList.toggle('hidden', students.length > 0);
  $('#teacherSubmitAllBtn').classList.toggle('hidden', students.length === 0);

  const template = $('#teacherStudentCardTemplate');
  students.forEach(student => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.student-card');
    card.dataset.id = student.id;
    card.dataset.groupId = groupId;
    card.style.setProperty('--group-color', groupColor(student.grade_level));
    node.querySelector('.avatar-orb').textContent = initials(student.name);
    node.querySelector('.s-name').textContent = student.name;
    node.querySelector('.s-id').textContent = student.student_code;
    node.querySelector('.tag-group').textContent = student.grade_level || '—';

    const status = statusOf(student.id);
    const pill = node.querySelector('[data-role="statusPill"]');
    pill.textContent = status.label;
    pill.className = `status-chip ${status.cls}`.trim();

    const existing = DB.getPendingRecordForStudentToday(student.id) || DB.getApprovedRecordForStudentToday(student.id);
    if (existing) {
      node.querySelector('[data-field="homeworkMax"]').value = existing.homework_out_of ?? 20;
      node.querySelector('[data-field="examMax"]').value = existing.exam_out_of ?? 20;
      node.querySelector('[data-field="homeworkGrade"]').value = existing.homework_grade ?? '';
      node.querySelector('[data-field="examGrade"]').value = existing.exam_grade ?? '';
      node.querySelector('[data-field="notes"]').value = existing.teacher_notes ?? '';
    }
    list.appendChild(node);
  });
}
function initTeacherPortalDelegation() {
  $('#teacherStudentsList').addEventListener('click', async (e) => {
    const card = e.target.closest('.student-card');
    if (!card) return;
    const actionBtn = e.target.closest('[data-action="saveGrades"]');
    if (!actionBtn) return;
    const studentId = card.dataset.id;
    const groupId = card.dataset.groupId; // قراءة رقم المجموعة

    const record = await DB.submitTeacherReport(studentId, {
      groupId,
      examGrade: card.querySelector('[data-field="examGrade"]').value || null,
      examOutOf: Number(card.querySelector('[data-field="examMax"]').value) || 20,
      homeworkGrade: card.querySelector('[data-field="homeworkGrade"]').value || null,
      homeworkOutOf: Number(card.querySelector('[data-field="homeworkMax"]').value) || 20,
      notes: card.querySelector('[data-field="notes"]').value,
      teacherName: session?.full_name || 'المدرس',
    });
    if (!record) { toast('⚠️ تعذر حفظ الدرجات', 'error'); return; }
    toast('✅ تم حفظ الدرجات — بانتظار اعتماد الإدارة', 'success');
    renderTeacherStudentsList(groupId);
    refreshSideBadge();
  });

  $('#teacherSubmitAllBtn').addEventListener('click', async () => {
    const groupId = $('#teacherGroupSelect').value;
    // ملاحظة: نأخذ كل طلاب المجموعة (بدون فلتر البحث) حتى لا يفوت أي طالب من التقرير النهائي
    const students = groupId ? DB.getStudentsByGroup(groupId) : [];
    if (!students.length) return;
    const ok = await askConfirm('إرسال التقرير للأدمن؟', `سيتم إرسال تقرير ${students.length} طالب للاعتماد. أي طالب لم يمر على السكرتير سيُسجَّل غائباً تلقائياً.`);
    if (!ok) return;

    // الحالة 1 والحالة 2: نحفظ درجات كل طالب ظاهر حالياً في القائمة (سواء وضع المدرس درجات أو تركها فارغة)
    const cards = $$('#teacherStudentsList .student-card');
    for (const card of cards) {
      const studentId = card.dataset.id;
      await DB.submitTeacherReport(studentId, {
        groupId,
        examGrade: card.querySelector('[data-field="examGrade"]').value || null,
        examOutOf: Number(card.querySelector('[data-field="examMax"]').value) || 20,
        homeworkGrade: card.querySelector('[data-field="homeworkGrade"]').value || null,
        homeworkOutOf: Number(card.querySelector('[data-field="homeworkMax"]').value) || 20,
        notes: card.querySelector('[data-field="notes"]').value,
        teacherName: session?.full_name || 'المدرس',
      });
    }

    // الحالة 3: أي طالب بالمجموعة لم يمر على السكرتير إطلاقاً اليوم يُسجَّل غائباً تلقائياً الآن
    const autoAbsent = await DB.finalizeGroupReport(groupId, session?.full_name || 'المدرس');
    if (autoAbsent.length) {
      toast(`📤 تم إرسال التقرير — وتسجيل ${autoAbsent.length} طالب غائباً تلقائياً`, 'success');
    } else {
      toast('📤 تم إرسال التقرير الكامل للإدارة', 'success');
    }
    refreshSideBadge();
    renderTeacherPortalRoot();
  });
}

/* ==========================================================================
   Approvals (admin)
   ========================================================================== */
function buildApprovalCard(record) {
  const student = DB.getStudentById(record.student_id);
  const template = $('#approvalCardTemplate');
  const node = template.content.cloneNode(true);
  if (!student) return document.createElement('div');
  node.querySelector('.approval-card').dataset.id = record.id;
  node.querySelector('.avatar-orb').textContent = initials(student.name);
  node.querySelector('.s-name').textContent = student.name;
  node.querySelector('.s-id').textContent = student.student_code;
  node.querySelector('.tag-group').textContent = student.grade_level || '—';
  node.querySelector('[data-role="time"]').textContent = record.time_in || '';

  node.querySelector('[data-role="attendancePill"]').textContent =
    record.attendance === 'present' ? '✅ حاضر' : record.attendance === 'absent' ? '❌ غائب' : '— لم يُسجَّل';
  node.querySelector('[data-role="paymentPill"]').textContent = record.amount_paid ? `💰 دفع (${fmt(record.amount_paid)} ج)` : '💸 لم يدفع';
  node.querySelector('[data-role="homeworkPill"]').textContent = `واجب: ${record.homework_grade ?? '—'}/${record.homework_out_of ?? '—'}`;
  node.querySelector('[data-role="examPill"]').textContent = `امتحان: ${record.exam_grade ?? '—'}/${record.exam_out_of ?? '—'}`;
  node.querySelector('[data-role="notesText"]').textContent = record.teacher_notes || 'لا توجد ملاحظات';
  node.querySelector('[data-role="secretaryName"]').textContent = `بواسطة: ${record.secretary_name || '—'}`;
  return node;
}
function renderApprovalsPage() {
  const list = $('#approvalsList');
  const pending = DB.getPendingRecords();
  $('#noApprovals').classList.toggle('hidden', pending.length > 0);
  list.innerHTML = '';
  pending.forEach(record => {
    const student = DB.getStudentById(record.student_id);
    if (!student) return;
    list.appendChild(buildApprovalCard(record));
  });
  refreshSideBadge();
}
function initApprovalsActions() {
  const handler = async (e) => {
    const card = e.target.closest('.approval-card');
    if (!card) return;
    const id = card.dataset.id;
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;

    if (actionBtn.dataset.action === 'approve') {
      const record = await DB.approveRecord(id);
      if (!record) { toast('⚠️ تعذر اعتماد السجل', 'error'); return; }
      toast('✅ تم اعتماد السجل', 'success');
      renderPage(currentPage);
    } else if (actionBtn.dataset.action === 'edit') {
      openEditModal(id);
    }
  };
  $('#approvalsList').addEventListener('click', handler);
  $('#dashPendingPreview').addEventListener('click', handler);

  $('#approveAllBtn').addEventListener('click', async () => {
    const pending = DB.getPendingRecords();
    if (!pending.length) { toast('لا توجد سجلات لاعتمادها'); return; }
    const ok = await askConfirm('اعتماد جميع السجلات؟', `سيتم اعتماد ${pending.length} سجل.`);
    if (ok) { await DB.approveAll(); toast('✅ تم اعتماد جميع السجلات', 'success'); renderPage(currentPage); }
  });
}

/* ---------------- Edit modal ---------------- */
function openEditModal(recordId) {
  const record = DB.getPendingRecords().find(r => String(r.id) === String(recordId));
  if (!record) return;
  const student = DB.getStudentById(record.student_id);
  pendingEditId = recordId;

  $('#editStudentName').textContent = `${student.name} — #${student.student_code}`;
  $('#editPresentBtn').classList.toggle('active', record.attendance === 'present');
  $('#editAbsentBtn').classList.toggle('active', record.attendance === 'absent');
  $('#editPaidBtn').classList.toggle('active', record.payment_status === 'paid');
  $('#editUnpaidBtn').classList.toggle('active', record.payment_status === 'unpaid');
  $('#editHomeworkMax').value = record.homework_out_of ?? 20;
  $('#editExamMax').value = record.exam_out_of ?? 20;
  $('#editHomeworkGrade').value = record.homework_grade ?? '';
  $('#editExamGrade').value = record.exam_grade ?? '';
  $('#editAmountPaid').value = record.amount_paid ?? 0;
  $('#editNotes').value = record.teacher_notes ?? '';
  $('#editModal').classList.remove('hidden');
}
function initEditModal() {
  $('#editModalClose').addEventListener('click', () => $('#editModal').classList.add('hidden'));
  $('#editPresentBtn').addEventListener('click', () => { $('#editPresentBtn').classList.add('active'); $('#editAbsentBtn').classList.remove('active'); });
  $('#editAbsentBtn').addEventListener('click', () => { $('#editAbsentBtn').classList.add('active'); $('#editPresentBtn').classList.remove('active'); });
  $('#editPaidBtn').addEventListener('click', () => { $('#editPaidBtn').classList.add('active'); $('#editUnpaidBtn').classList.remove('active'); });
  $('#editUnpaidBtn').addEventListener('click', () => { $('#editUnpaidBtn').classList.add('active'); $('#editPaidBtn').classList.remove('active'); });

  $('#saveEditBtn').addEventListener('click', async () => {
    if (!pendingEditId) return;
    const record = DB.getPendingRecords().find(r => String(r.id) === String(pendingEditId));
    const prevPaid = Number(record?.amount_paid) || 0;
    const newPaid = Number($('#editAmountPaid').value) || 0;

    await DB.updateRecord(pendingEditId, {
      attendance: $('#editPresentBtn').classList.contains('active') ? 'present' : $('#editAbsentBtn').classList.contains('active') ? 'absent' : 'none',
      paymentStatus: $('#editPaidBtn').classList.contains('active') ? 'paid' : 'unpaid',
      homeworkMax: Number($('#editHomeworkMax').value),
      examMax: Number($('#editExamMax').value),
      homeworkGrade: $('#editHomeworkGrade').value || null,
      examGrade: $('#editExamGrade').value || null,
      amountPaid: newPaid,
      teacherNotes: $('#editNotes').value,
    });

    // إذا تغيّر المبلغ المدفوع، عدّل مديونية الطالب بالفارق
    if (record && newPaid !== prevPaid) {
      await DB.adjustStudentDebt(record.student_id, -(newPaid - prevPaid));
    }

    $('#editModal').classList.add('hidden');
    toast('✅ تم حفظ التعديلات', 'success');
    renderPage(currentPage);
  });

  $('#deleteRecordBtn').addEventListener('click', async () => {
    const ok = await askConfirm('حذف السجل؟', 'سيتم حذف هذا السجل نهائيًا قبل اعتماده.');
    if (ok && pendingEditId) {
      await DB.deleteRecord(pendingEditId);
      $('#editModal').classList.add('hidden');
      toast('🗑️ تم حذف السجل');
      renderPage(currentPage);
    }
  });
}

/* ==========================================================================
   Global wiring
   ========================================================================== */
function initGlobalUi() {
  $('#themeToggleBtn').addEventListener('click', toggleTheme);
  $('#logoutBtn').addEventListener('click', logout);
  $('#qrViewModalClose').addEventListener('click', () => $('#qrViewModal').classList.add('hidden'));
  $('#printQrViewBtn').addEventListener('click', () => {
    const flip = $('#qrViewCardPreview .flip-card');
    if (flip) flip.classList.add('flipped');
    setTimeout(() => window.print(), 250);
  });
  $('#confirmCancelBtn').addEventListener('click', () => closeConfirm(false));
  $('#confirmOkBtn').addEventListener('click', () => closeConfirm(true));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal-overlay:not(.hidden)').forEach(m => { if (m.id !== 'loginModal') m.classList.add('hidden'); });
      if (html5QrInstance) stopScanner();
    }
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  DB.loadCenterInfoLocal();
  initTheme();
  applyCenterBranding();
  initTilt();
  initFlipCards();
  initLogin();
  initSidebar();
  initGlobalUi();
  initStudentsListDelegation();
  initStudentsDirectoryFilters();
  initStudentFinanceModal();
  initSfEnrollCascadingSelects();
  initTeacherModal();
  initGroupModal();
  initGradeLevelsPage();
  initSecretariesPage();
  initExpenseModal();
  initFinanceFilters();
  initMasterTable();
  initSettingsPage();
  initTeacherPortalDelegation();
  initTeacherCascadingSelects();
  initTeacherSearch();
  initCascadingStudentSelects();
  initAddStudentModal();
  initScanner();
  initApprovalsActions();
  initEditModal();

  // حفظ الجلسة عند الـ Refresh: لو فيه جلسة محفوظة في localStorage، ندخل مباشرة بدون شاشة تسجيل الدخول
  try {
    const savedSession = localStorage.getItem('attef_session');
    if (savedSession) {
      session = JSON.parse(savedSession);
      enterApp();
    }
  } catch (err) {
    console.error('[Session] تعذّرت قراءة الجلسة المحفوظة:', err);
    localStorage.removeItem('attef_session');
  }

  setTimeout(() => {
    $('#splashScreen').classList.add('fade-out');
    setTimeout(() => $('#splashScreen').remove(), 650);
  }, 1000);
});
// تسجيل الـ Service Worker وإظهار نافذة التثبيت أوتوماتيكياً
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration failed:', err));
  });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  toast('📱 اضغط هنا لإضافة التطبيق للشاشة الرئيسية!', 'info');
  setTimeout(() => {
    if (deferredPrompt) deferredPrompt.prompt();
  }, 1500);
});