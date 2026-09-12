(() => {
  'use strict';

  const $p = id => document.getElementById(id);
  const KEY = 'maiaekhub_security_events_v1';
  const NOTIF_KEY = 'maiaekhub_notifications_v1';

  let otpSentAt = 0;
  let otpVerified = false;
  let countdownTimer = null;

  const current = () =>
    typeof currentUser !== 'undefined' ? currentUser : null;

  const profile = () =>
    typeof currentProfile !== 'undefined' ? currentProfile : null;

  const client = () =>
    typeof sb !== 'undefined' ? sb : null;

  const esc = v =>
    String(v ?? '').replace(/[&<>'"]/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[c]));

  const localRead = k => {
    try {
      return JSON.parse(localStorage.getItem(k) || '[]');
    } catch {
      return [];
    }
  };

  const localWrite = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v.slice(-50)));
    } catch {}
  };

  function addEvent(type, label, meta = {}) {
    const u = current();

    if (!u?.id) return;

    const row = {
      id: crypto.randomUUID(),
      user_id: u.id,
      type,
      label,
      meta,
      created_at: new Date().toISOString()
    };

    const a = localRead(KEY).filter(x => x.user_id === u.id);
    a.push(row);
    localWrite(KEY, a);

    const n = localRead(NOTIF_KEY).filter(x => x.user_id === u.id);
    n.push({
      ...row,
      read: false
    });
    localWrite(NOTIF_KEY, n);

    const s = client();

    if (s) {
      s.from('security_events')
        .insert({
          user_id: u.id,
          event_type: type,
          event_label: label,
          metadata: meta
        })
        .then(() => {})
        .catch(() => {});
    }
  }

  function openModal(id) {
    const e = $p(id);

    if (e) {
      e.hidden = false;
      e.classList.add('is-visible');
    }
  }

  function closeModal(id) {
    const e = $p(id);

    if (e) {
      e.classList.remove('is-visible');
      e.hidden = true;
    }
  }

  function openProfileExtras() {
    const u = current();
    const p = profile();

    if (!u) return;

    if ($p('fEmail')) {
      $p('fEmail').value = u.email || p?.email || '';
    }

    if ($p('fPhone')) {
      $p('fPhone').value = u.user_metadata?.phone || '';
    }
  }

  async function savePersonalInfo(e) {
    e.preventDefault();
    e.stopImmediatePropagation();

    const s = client();
    const u = current();
    const p = profile();
    const err = $p('profileFormError');
    const btn = $p('saveProfileBtn');

    if (!s || !u) return;

    const email = $p('fEmail')?.value.trim() || '';
    const phone = $p('fPhone')?.value.trim() || '';
    const display = $p('fDisplayName')?.value.trim() || '';

    if (!email) {
      if (err) err.textContent = 'กรุณาระบุอีเมล';
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-loading');
    }

    try {
      let avatarUrl = p?.avatar_url || null;
      const file = $p('profileAvatarInput')?.files?.[0];

      if (file) {
        if (file.size > 8 * 1024 * 1024) {
          throw new Error('ไฟล์ใหญ่เกินไป (สูงสุด 8MB)');
        }

        const ext = file.name.split('.').pop().toLowerCase();
        const path = `${u.id}/avatar.${ext}`;

        const up = await s.storage
          .from('avatars')
          .upload(path, file, {
            upsert: true,
            cacheControl: '3600'
          });

        if (up.error) throw up.error;

        avatarUrl =
          `${s.storage.from('avatars').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      }

      const authUpdate = {
        data: {
          phone: phone || null
        }
      };

      if (email !== u.email) {
        authUpdate.email = email;
      }

      const {
        data: userData,
        error: authErr
      } = await s.auth.updateUser(authUpdate);

      if (authErr) throw authErr;

      const {
        data,
        error: dbErr
      } = await s
        .from('profiles')
        .update({
          display_name: display || null,
          avatar_url: avatarUrl
        })
        .eq('id', u.id)
        .select('id, username, role, email, display_name, avatar_url')
        .single();

      if (dbErr) throw dbErr;

      currentProfile = {
        ...p,
        ...data,
        email: userData?.user?.email || p?.email || email
      };

      currentUser = userData?.user || u;

      if (typeof applyRolePermissions === 'function') {
        applyRolePermissions();
      }

      addEvent(
        'profile_updated',
        'อัปเดตข้อมูลโปรไฟล์',
        {
          email_changed: email !== u.email,
          phone_changed: phone !== (u.user_metadata?.phone || '')
        }
      );

      if (typeof showToast === 'function') {
        showToast(
          email !== u.email
            ? 'บันทึกแล้ว — กรุณายืนยันอีเมลใหม่'
            : 'บันทึกโปรไฟล์สำเร็จ',
          'success'
        );
      }

      closeModal('profileModal');
    } catch (ex) {
      if (err) {
        err.textContent = ex.message || 'บันทึกโปรไฟล์ไม่สำเร็จ';
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }
  }

  function meter(v) {
    const b = $p('passwordMeterBar');
    const l = $p('passwordMeterLabel');

    if (!b || !l) return;

    let score = 0;

    if (v.length >= 6) score++;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[0-9]/.test(v)) score++;

    b.style.width = ([0, 25, 50, 75, 100][score] || 0) + '%';

    l.textContent =
      !v
        ? 'กรอกรหัสผ่าน'
        : score < 2
          ? 'อ่อน'
          : score < 3
            ? 'พอใช้'
            : score < 4
              ? 'ดี'
              : 'แข็งแรง';
  }

  function resetFlow() {
    otpVerified = false;
    otpSentAt = 0;

    clearInterval(countdownTimer);

    ['otpStepVerify', 'otpStepPassword'].forEach(id => {
      $p(id).hidden = true;
    });

    $p('otpStepSend').hidden = false;
    $p('passwordOtpInput').value = '';
    $p('newPasswordInput').value = '';
    $p('confirmNewPasswordInput').value = '';
    $p('passwordChangeError').textContent = '';
  }

  function openPasswordFlow() {
    const u = current();
    const email = u?.email || profile()?.email || '';

    if (!email) {
      showToast?.('บัญชีนี้ไม่มีอีเมลสำหรับรับ OTP', 'error');
      return;
    }

    resetFlow();
    $p('otpTargetEmail').textContent = maskEmail(email);
    openModal('passwordOtpModal');
  }

  function maskEmail(e) {
    const [a, b] = String(e).split('@');

    return b
      ? `${a.slice(0, 2)}${a.length > 2 ? '•••' : ''}@${b}`
      : e;
  }

  async function sendEmailViaResend({ to, subject, html }) {
    const supabase = client();

    if (!supabase) {
      throw new Error('ไม่พบการเชื่อมต่อ Supabase');
    }

    const {
      data,
      error
    } = await supabase.functions.invoke('send-email', {
      body: {
        to,
        subject,
        html
      }
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return data;
  }

  async function sendSecurityNotification({
    subject,
    title,
    message
  }) {
    const user = current();
    const email = user?.email || profile()?.email || '';

    if (!email) return;

    try {
      await sendEmailViaResend({
        to: email,
        subject,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222">
            <h2>${esc(title)}</h2>
            <p style="white-space:pre-line;line-height:1.7">
              ${esc(message)}
            </p>
            <hr>
            <small style="color:#777">MaiaekHub</small>
          </div>
        `
      });
    } catch (error) {
      console.error('Resend notification error:', error);
    }
  }

  async function sendOtp() {
    const s = client();
    const u = current();
    const email = u?.email || profile()?.email;

    if (!s || !email) return;

    const btn = $p('sendPasswordOtpBtn');

    if (btn) btn.disabled = true;

    try {
      const {
        error
      } = await s.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: location.href
        }
      });

      if (error) throw error;

      otpSentAt = Date.now();

      $p('otpStepSend').hidden = true;
      $p('otpStepVerify').hidden = false;
      $p('passwordOtpInput').focus();

      startCountdown();

      addEvent(
        'password_otp_sent',
        'ส่ง OTP สำหรับเปลี่ยนรหัสผ่าน'
      );

      showToast?.('ส่ง OTP ไปยังอีเมลแล้ว', 'success');
    } catch (ex) {
      showToast?.(
        ex.message || 'ส่ง OTP ไม่สำเร็จ',
        'error'
      );
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function startCountdown() {
    clearInterval(countdownTimer);

    const el = $p('otpCountdown');
    const end = otpSentAt + 300000;

    const tick = () => {
      const left = Math.max(0, end - Date.now());

      if (el) {
        el.textContent = left
          ? `OTP หมดอายุใน ${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor(left % 60000 / 1000)).padStart(2, '0')}`
          : 'OTP หมดอายุแล้ว';
      }

      if (!left) {
        clearInterval(countdownTimer);
      }
    };

    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  async function verifyOtp() {
    const s = client();
    const u = current();
    const email = u?.email || profile()?.email;
    const token = $p('passwordOtpInput').value.trim();

    if (
      !s ||
      !email ||
      !/^[0-9]{6}$/.test(token)
    ) {
      showToast?.('กรุณากรอก OTP 6 หลัก', 'error');
      return;
    }

    const btn = $p('verifyPasswordOtpBtn');

    if (btn) btn.disabled = true;

    try {
      const {
        data,
        error
      } = await s.auth.verifyOtp({
        email,
        token,
        type: 'email'
      });

      if (error) throw error;

      if (!data?.session) {
        throw new Error('ยืนยัน OTP สำเร็จแต่ไม่พบเซสชัน');
      }

      otpVerified = true;

      $p('otpStepVerify').hidden = true;
      $p('otpStepPassword').hidden = false;
      $p('newPasswordInput').focus();

      addEvent(
        'password_otp_verified',
        'ยืนยัน OTP สำเร็จ'
      );
    } catch (ex) {
      showToast?.(
        ex.message || 'OTP ไม่ถูกต้องหรือหมดอายุ',
        'error'
      );
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function saveNewPassword() {
    const s = client();
    const p = $p('newPasswordInput').value;
    const c = $p('confirmNewPasswordInput').value;
    const err = $p('passwordChangeError');

    if (!otpVerified) {
      err.textContent = 'กรุณายืนยัน OTP ก่อน';
      return;
    }

    if (p.length < 6) {
      err.textContent = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
      return;
    }

    if (p !== c) {
      err.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
      return;
    }

    const btn = $p('saveNewPasswordBtn');

    if (btn) btn.disabled = true;

    try {
      const {
        error
      } = await s.auth.updateUser({
        password: p
      });

      if (error) throw error;

      addEvent(
        'password_changed',
        'เปลี่ยนรหัสผ่านสำเร็จ'
      );

      await sendSecurityNotification({
        subject: 'MaiaekHub: เปลี่ยนรหัสผ่านสำเร็จ',
        title: 'เปลี่ยนรหัสผ่านสำเร็จ',
        message:
          'รหัสผ่านบัญชีของคุณถูกเปลี่ยนเรียบร้อยแล้ว หากไม่ใช่คุณ กรุณาออกจากระบบทุกอุปกรณ์และติดต่อผู้ดูแลระบบ'
      });

      closeModal('passwordOtpModal');

      showToast?.(
        'เปลี่ยนรหัสผ่านสำเร็จ',
        'success'
      );
    } catch (ex) {
      err.textContent =
        ex.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function openSecurity() {
    const u = current();
    const p = profile();

    if (!u) return;

    openModal('securityModal');

    const email = u.email || p?.email || '';
    const phone = u.user_metadata?.phone || '';

    $p('securityEmail').textContent = email || '—';
    $p('securityPhone').textContent =
      phone || 'ยังไม่ได้ระบุ';

    $p('securityEmailStatus').textContent =
      u.email_confirmed_at
        ? 'ยืนยันแล้ว'
        : 'ยังไม่ได้ยืนยัน';

    const {
      data: {
        session
      }
    } = await client().auth.getSession();

    $p('securityCurrentSession').textContent =
      session ? 'ใช้งานอยู่' : 'ไม่มีเซสชัน';

    $p('securityCurrentSessionMeta').textContent =
      session
        ? `${new Date().toLocaleString('th-TH')} · เบราว์เซอร์นี้`
        : '—';

    let list = localRead(KEY)
      .filter(x => x.user_id === u.id)
      .slice(-10)
      .reverse();

    try {
      const r = await client()
        .from('security_events')
        .select(
          'event_type,event_label,metadata,created_at'
        )
        .eq('user_id', u.id)
        .order('created_at', {
          ascending: false
        })
        .limit(20);

      if (
        !r.error &&
        Array.isArray(r.data) &&
        r.data.length
      ) {
        list = r.data.map(x => ({
          type: x.event_type,
          label: x.event_label,
          meta: x.metadata,
          created_at: x.created_at
        }));
      }
    } catch {}

    $p('loginActivityList').innerHTML = list.length
      ? list.map(x => `
          <div class="security-list-row">
            <div>
              <strong>${esc(x.label)}</strong>
              <small>
                ${new Date(x.created_at).toLocaleString('th-TH')}
              </small>
            </div>
            <span>${esc(x.type)}</span>
          </div>
        `).join('')
      : '<div class="empty-state-inline">ยังไม่มีกิจกรรม</div>';

    $p('sessionList').innerHTML = `
      <div class="security-list-row">
        <div>
          <strong>อุปกรณ์นี้ · เซสชันปัจจุบัน</strong>
          <small>
            ${navigator.userAgent.includes('Android') ? 'Android' : 'Browser'}
            · ${new Date().toLocaleString('th-TH')}
          </small>
        </div>
        <span class="security-current">กำลังใช้งาน</span>
      </div>
    `;
  }

  async function openNotifications() {
    const u = current();

    if (!u) return;

    openModal('notificationsModal');

    let n = localRead(NOTIF_KEY)
      .filter(x => x.user_id === u.id)
      .slice(-30)
      .reverse();

    try {
      const r = await client()
        .from('security_events')
        .select(
          'event_type,event_label,created_at'
        )
        .eq('user_id', u.id)
        .order('created_at', {
          ascending: false
        })
        .limit(30);

      if (
        !r.error &&
        Array.isArray(r.data) &&
        r.data.length
      ) {
        n = r.data.map(x => ({
          type: x.event_type,
          label: x.event_label,
          created_at: x.created_at,
          read: false
        }));
      }
    } catch {}

    $p('notificationsEmpty').hidden = !!n.length;

    $p('notificationsList').innerHTML = n.map(x => `
      <div class="notification-row ${x.read ? 'is-read' : ''}">
        <span class="notification-dot"></span>
        <div>
          <strong>${esc(x.label)}</strong>
          <small>
            ${new Date(x.created_at).toLocaleString('th-TH')}
          </small>
        </div>
      </div>
    `).join('');
  }

  async function signOutAll() {
    if (
      !confirm(
        'ออกจากระบบทุกอุปกรณ์และเบราว์เซอร์ที่กำลังใช้งานบัญชีนี้หรือไม่?'
      )
    ) {
      return;
    }

    const s = client();

    try {
      addEvent(
        'signout_all',
        'ออกจากระบบทุกอุปกรณ์'
      );

      await s.auth.signOut({
        scope: 'global'
      });
    } catch (ex) {
      showToast?.(
        ex.message || 'ไม่สามารถออกจากระบบทุกอุปกรณ์ได้',
        'error'
      );
    }
  }

  function markRead() {
    const u = current();

    if (!u) return;

    localWrite(
      NOTIF_KEY,
      localRead(NOTIF_KEY).map(x =>
        x.user_id === u.id
          ? {
              ...x,
              read: true
            }
          : x
      )
    );

    openNotifications();
  }

  function bind() {
    const profileBtn = $p('profileAvatarBtn');

    profileBtn?.addEventListener(
      'click',
      () => setTimeout(openProfileExtras, 0)
    );

    const form = $p('profileForm');

    form?.addEventListener(
      'submit',
      savePersonalInfo,
      true
    );

    $p('openPasswordChangeBtn')
      ?.addEventListener(
        'click',
        openPasswordFlow
      );

    $p('securityChangePasswordBtn')
      ?.addEventListener(
        'click',
        openPasswordFlow
      );

    $p('securityCenterBtn')
      ?.addEventListener(
        'click',
        openSecurity
      );

    $p('notificationsBtn')
      ?.addEventListener(
        'click',
        openNotifications
      );

    $p('closeSecurityModal')
      ?.addEventListener(
        'click',
        () => closeModal('securityModal')
      );

    $p('closeNotificationsModal')
      ?.addEventListener(
        'click',
        () => closeModal('notificationsModal')
      );

    $p('closePasswordOtpModal')
      ?.addEventListener(
        'click',
        () => closeModal('passwordOtpModal')
      );

    $p('securityModal')
      ?.addEventListener(
        'click',
        e => {
          if (e.target.id === 'securityModal') {
            closeModal('securityModal');
          }
        }
      );

    $p('notificationsModal')
      ?.addEventListener(
        'click',
        e => {
          if (e.target.id === 'notificationsModal') {
            closeModal('notificationsModal');
          }
        }
      );

    $p('passwordOtpModal')
      ?.addEventListener(
        'click',
        e => {
          if (e.target.id === 'passwordOtpModal') {
            closeModal('passwordOtpModal');
          }
        }
      );

    $p('sendPasswordOtpBtn')
      ?.addEventListener(
        'click',
        sendOtp
      );

    $p('resendPasswordOtpBtn')
      ?.addEventListener(
        'click',
        sendOtp
      );

    $p('verifyPasswordOtpBtn')
      ?.addEventListener(
        'click',
        verifyOtp
      );

    $p('saveNewPasswordBtn')
      ?.addEventListener(
        'click',
        saveNewPassword
      );

    $p('newPasswordInput')
      ?.addEventListener(
        'input',
        e => meter(e.target.value)
      );

    $p('passwordOtpInput')
      ?.addEventListener(
        'input',
        e => {
          e.target.value = e.target.value
            .replace(/\D/g, '')
            .slice(0, 6);
        }
      );

    $p('signOutAllBtn')
      ?.addEventListener(
        'click',
        signOutAll
      );

    $p('markNotificationsReadBtn')
      ?.addEventListener(
        'click',
        markRead
      );
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      bind
    );
  } else {
    bind();
  }

  window.maiaekhubPhase1 = {
    openPasswordFlow,
    openSecurity,
    openNotifications,
    addEvent
  };
})();
