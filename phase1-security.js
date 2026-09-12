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

  const esc = value =>
    String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));

  const localRead = key => {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  };

  const localWrite = (key, value) => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify(value.slice(-50))
      );
    } catch {}
  };

  function addEvent(type, label, meta = {}) {
    const user = current();

    if (!user?.id) return;

    const row = {
      id: crypto.randomUUID(),
      user_id: user.id,
      type,
      label,
      meta,
      created_at: new Date().toISOString()
    };

    const events = localRead(KEY)
      .filter(item => item.user_id === user.id);

    events.push(row);
    localWrite(KEY, events);

    const notifications = localRead(NOTIF_KEY)
      .filter(item => item.user_id === user.id);

    notifications.push({
      ...row,
      read: false
    });

    localWrite(NOTIF_KEY, notifications);

    const supabase = client();

    if (supabase) {
      supabase
        .from('security_events')
        .insert({
          user_id: user.id,
          event_type: type,
          event_label: label,
          metadata: meta
        })
        .then(() => {})
        .catch(() => {});
    }
  }

  function openModal(id) {
    const element = $p(id);

    if (element) {
      element.hidden = false;
      element.classList.add('is-visible');
    }
  }

  function closeModal(id) {
    const element = $p(id);

    if (element) {
      element.classList.remove('is-visible');
      element.hidden = true;
    }
  }

  function openProfileExtras() {
    const user = current();
    const userProfile = profile();

    if (!user) return;

    if ($p('fEmail')) {
      $p('fEmail').value =
        user.email || userProfile?.email || '';
    }

    if ($p('fPhone')) {
      $p('fPhone').value =
        user.user_metadata?.phone || '';
    }
  }

  async function savePersonalInfo(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const supabase = client();
    const user = current();
    const userProfile = profile();
    const errorElement = $p('profileFormError');
    const saveButton = $p('saveProfileBtn');

    if (!supabase || !user) return;

    const email =
      $p('fEmail')?.value.trim() || '';

    const phone =
      $p('fPhone')?.value.trim() || '';

    const displayName =
      $p('fDisplayName')?.value.trim() || '';

    if (!email) {
      if (errorElement) {
        errorElement.textContent =
          'กรุณาระบุอีเมล';
      }

      return;
    }

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.classList.add('is-loading');
    }

    try {
      let avatarUrl =
        userProfile?.avatar_url || null;

      const file =
        $p('profileAvatarInput')?.files?.[0];

      if (file) {
        if (file.size > 8 * 1024 * 1024) {
          throw new Error(
            'ไฟล์ใหญ่เกินไป (สูงสุด 8MB)'
          );
        }

        const extension =
          file.name
            .split('.')
            .pop()
            .toLowerCase();

        const path =
          `${user.id}/avatar.${extension}`;

        const upload =
          await supabase.storage
            .from('avatars')
            .upload(
              path,
              file,
              {
                upsert: true,
                cacheControl: '3600'
              }
            );

        if (upload.error) {
          throw upload.error;
        }

        avatarUrl =
          `${
            supabase.storage
              .from('avatars')
              .getPublicUrl(path)
              .data.publicUrl
          }?v=${Date.now()}`;
      }

      const authUpdate = {
        data: {
          phone: phone || null
        }
      };

      if (email !== user.email) {
        authUpdate.email = email;
      }

      const {
        data: userData,
        error: authError
      } = await supabase.auth.updateUser(
        authUpdate
      );

      if (authError) {
        throw authError;
      }

      const {
        data,
        error: databaseError
      } = await supabase
        .from('profiles')
        .update({
          display_name: displayName || null,
          avatar_url: avatarUrl
        })
        .eq('id', user.id)
        .select(
          'id, username, role, email, display_name, avatar_url'
        )
        .single();

      if (databaseError) {
        throw databaseError;
      }

      currentProfile = {
        ...userProfile,
        ...data,
        email:
          userData?.user?.email ||
          userProfile?.email ||
          email
      };

      currentUser =
        userData?.user || user;

      if (
        typeof applyRolePermissions === 'function'
      ) {
        applyRolePermissions();
      }

      addEvent(
        'profile_updated',
        'อัปเดตข้อมูลโปรไฟล์',
        {
          email_changed:
            email !== user.email,

          phone_changed:
            phone !==
            (user.user_metadata?.phone || '')
        }
      );

      if (typeof showToast === 'function') {
        showToast(
          email !== user.email
            ? 'บันทึกแล้ว — กรุณายืนยันอีเมลใหม่'
            : 'บันทึกโปรไฟล์สำเร็จ',
          'success'
        );
      }

      closeModal('profileModal');

    } catch (error) {
      if (errorElement) {
        errorElement.textContent =
          error.message ||
          'บันทึกโปรไฟล์ไม่สำเร็จ';
      }

    } finally {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.classList.remove('is-loading');
      }
    }
  }

  function meter(value) {
    const bar = $p('passwordMeterBar');
    const label = $p('passwordMeterLabel');

    if (!bar || !label) return;

    let score = 0;

    if (value.length >= 6) score++;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[0-9]/.test(value)) score++;

    bar.style.width =
      ([0, 25, 50, 75, 100][score] || 0) + '%';

    label.textContent =
      !value
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

    [
      'otpStepVerify',
      'otpStepPassword'
    ].forEach(id => {
      if ($p(id)) {
        $p(id).hidden = true;
      }
    });

    if ($p('otpStepSend')) {
      $p('otpStepSend').hidden = false;
    }

    if ($p('passwordOtpInput')) {
      $p('passwordOtpInput').value = '';
    }

    if ($p('newPasswordInput')) {
      $p('newPasswordInput').value = '';
    }

    if ($p('confirmNewPasswordInput')) {
      $p('confirmNewPasswordInput').value = '';
    }

    if ($p('passwordChangeError')) {
      $p('passwordChangeError').textContent = '';
    }
  }

  function openPasswordFlow() {
    const user = current();

    const email =
      user?.email ||
      profile()?.email ||
      '';

    if (!email) {
      showToast?.(
        'บัญชีนี้ไม่มีอีเมลสำหรับรับ OTP',
        'error'
      );

      return;
    }

    resetFlow();

    if ($p('otpTargetEmail')) {
      $p('otpTargetEmail').textContent =
        maskEmail(email);
    }

    openModal('passwordOtpModal');
  }

  function maskEmail(email) {
    const [name, domain] =
      String(email).split('@');

    if (!domain) return email;

    return `${name.slice(0, 2)}${
      name.length > 2 ? '•••' : ''
    }@${domain}`;
  }

  async function sendOtp() {
    const supabase = client();
    const user = current();

    const email =
      user?.email ||
      profile()?.email;

    if (!supabase || !email) return;

    const button =
      $p('sendPasswordOtpBtn');

    if (button) {
      button.disabled = true;
    }

    try {
      const { error } =
        await supabase.auth.signInWithOtp({
          email,

          options: {
            shouldCreateUser: false,
            emailRedirectTo: location.href
          }
        });

      if (error) {
        throw error;
      }

      otpSentAt = Date.now();

      $p('otpStepSend').hidden = true;
      $p('otpStepVerify').hidden = false;
      $p('passwordOtpInput').focus();

      startCountdown();

      addEvent(
        'password_otp_sent',
        'ส่ง OTP สำหรับเปลี่ยนรหัสผ่าน'
      );

      showToast?.(
        'ส่ง OTP ไปยังอีเมลแล้ว',
        'success'
      );

    } catch (error) {
      showToast?.(
        error.message ||
        'ส่ง OTP ไม่สำเร็จ',
        'error'
      );

    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  function startCountdown() {
    clearInterval(countdownTimer);

    const element =
      $p('otpCountdown');

    const end =
      otpSentAt + 300000;

    const tick = () => {
      const left =
        Math.max(0, end - Date.now());

      if (element) {
        element.textContent =
          left
            ? `OTP หมดอายุใน ${
                String(
                  Math.floor(left / 60000)
                ).padStart(2, '0')
              }:${
                String(
                  Math.floor(
                    (left % 60000) / 1000
                  )
                ).padStart(2, '0')
              }`
            : 'OTP หมดอายุแล้ว';
      }

      if (!left) {
        clearInterval(countdownTimer);
      }
    };

    tick();

    countdownTimer =
      setInterval(tick, 1000);
  }

  async function verifyOtp() {
    const supabase = client();
    const user = current();

    const email =
      user?.email ||
      profile()?.email;

    const token =
      $p('passwordOtpInput')
        .value
        .trim();

    if (
      !supabase ||
      !email ||
      !/^[0-9]{6}$/.test(token)
    ) {
      showToast?.(
        'กรุณากรอก OTP 6 หลัก',
        'error'
      );

      return;
    }

    const button =
      $p('verifyPasswordOtpBtn');

    if (button) {
      button.disabled = true;
    }

    try {
      const {
        data,
        error
      } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email'
      });

      if (error) {
        throw error;
      }

      if (!data?.session) {
        throw new Error(
          'ยืนยัน OTP สำเร็จแต่ไม่พบเซสชัน'
        );
      }

      otpVerified = true;

      $p('otpStepVerify').hidden = true;
      $p('otpStepPassword').hidden = false;
      $p('newPasswordInput').focus();

      addEvent(
        'password_otp_verified',
        'ยืนยัน OTP สำเร็จ'
      );

    } catch (error) {
      showToast?.(
        error.message ||
        'OTP ไม่ถูกต้องหรือหมดอายุ',
        'error'
      );

    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  async function saveNewPassword() {
    const supabase = client();

    const password =
      $p('newPasswordInput').value;

    const confirmPassword =
      $p('confirmNewPasswordInput').value;

    const errorElement =
      $p('passwordChangeError');

    if (!otpVerified) {
      errorElement.textContent =
        'กรุณายืนยัน OTP ก่อน';

      return;
    }

    if (password.length < 6) {
      errorElement.textContent =
        'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';

      return;
    }

    if (password !== confirmPassword) {
      errorElement.textContent =
        'รหัสผ่านทั้งสองช่องไม่ตรงกัน';

      return;
    }

    const button =
      $p('saveNewPasswordBtn');

    if (button) {
      button.disabled = true;
    }

    try {
      const { error } =
        await supabase.auth.updateUser({
          password
        });

      if (error) {
        throw error;
      }

      addEvent(
        'password_changed',
        'เปลี่ยนรหัสผ่านสำเร็จ'
      );

      closeModal('passwordOtpModal');

      showToast?.(
        'เปลี่ยนรหัสผ่านสำเร็จ',
        'success'
      );

    } catch (error) {
      errorElement.textContent =
        error.message ||
        'เปลี่ยนรหัสผ่านไม่สำเร็จ';

    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  async function openSecurity() {
    const user = current();
    const userProfile = profile();

    if (!user) return;

    openModal('securityModal');

    const email =
      user.email ||
      userProfile?.email ||
      '';

    const phone =
      user.user_metadata?.phone ||
      '';

    $p('securityEmail').textContent =
      email || '—';

    $p('securityPhone').textContent =
      phone || 'ยังไม่ได้ระบุ';

    $p('securityEmailStatus').textContent =
      user.email_confirmed_at
        ? 'ยืนยันแล้ว'
        : 'ยังไม่ได้ยืนยัน';

    const {
      data: sessionData
    } = await client()
      .auth
      .getSession();

    const session =
      sessionData?.session;

    $p('securityCurrentSession').textContent =
      session
        ? 'ใช้งานอยู่'
        : 'ไม่มีเซสชัน';

    $p('securityCurrentSessionMeta').textContent =
      session
        ? `${new Date().toLocaleString('th-TH')} · เบราว์เซอร์นี้`
        : '—';

    let list =
      localRead(KEY)
        .filter(item => item.user_id === user.id)
        .slice(-10)
        .reverse();

    try {
      const result =
        await client()
          .from('security_events')
          .select(
            'event_type,event_label,metadata,created_at'
          )
          .eq('user_id', user.id)
          .order('created_at', {
            ascending: false
          })
          .limit(20);

      if (
        !result.error &&
        Array.isArray(result.data) &&
        result.data.length
      ) {
        list = result.data.map(item => ({
          type: item.event_type,
          label: item.event_label,
          meta: item.metadata,
          created_at: item.created_at
        }));
      }
    } catch {}

    $p('loginActivityList').innerHTML =
      list.length
        ? list.map(item => `
          <div class="security-list-row">
            <div>
              <strong>
                ${esc(item.label)}
              </strong>

              <small>
                ${new Date(
                  item.created_at
                ).toLocaleString('th-TH')}
              </small>
            </div>

            <span>
              ${esc(item.type)}
            </span>
          </div>
        `).join('')
        : `
          <div class="empty-state-inline">
            ยังไม่มีกิจกรรม
          </div>
        `;

    $p('sessionList').innerHTML = `
      <div class="security-list-row">
        <div>
          <strong>
            อุปกรณ์นี้ · เซสชันปัจจุบัน
          </strong>

          <small>
            ${
              navigator.userAgent.includes('Android')
                ? 'Android'
                : 'Browser'
            } · ${
              new Date().toLocaleString('th-TH')
            }
          </small>
        </div>

        <span class="security-current">
          กำลังใช้งาน
        </span>
      </div>
    `;
  }

  async function openNotifications() {
    const user = current();

    if (!user) return;

    openModal('notificationsModal');

    let notifications =
      localRead(NOTIF_KEY)
        .filter(item => item.user_id === user.id)
        .slice(-30)
        .reverse();

    try {
      const result =
        await client()
          .from('security_events')
          .select(
            'event_type,event_label,created_at'
          )
          .eq('user_id', user.id)
          .order('created_at', {
            ascending: false
          })
          .limit(30);

      if (
        !result.error &&
        Array.isArray(result.data) &&
        result.data.length
      ) {
        notifications =
          result.data.map(item => ({
            type: item.event_type,
            label: item.event_label,
            created_at: item.created_at,
            read: false
          }));
      }
    } catch {}

    $p('notificationsEmpty').hidden =
      !!notifications.length;

    $p('notificationsList').innerHTML =
      notifications.map(item => `
        <div class="notification-row ${
          item.read ? 'is-read' : ''
        }">
          <span class="notification-dot"></span>

          <div>
            <strong>
              ${esc(item.label)}
            </strong>

            <small>
              ${new Date(
                item.created_at
              ).toLocaleString('th-TH')}
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

    const supabase = client();

    try {
      addEvent(
        'signout_all',
        'ออกจากระบบทุกอุปกรณ์'
      );

      await supabase.auth.signOut({
        scope: 'global'
      });

    } catch (error) {
      showToast?.(
        error.message ||
        'ไม่สามารถออกจากระบบทุกอุปกรณ์ได้',
        'error'
      );
    }
  }

  function markRead() {
    const user = current();

    if (!user) return;

    localWrite(
      NOTIF_KEY,

      localRead(NOTIF_KEY).map(item =>
        item.user_id === user.id
          ? {
              ...item,
              read: true
            }
          : item
      )
    );

    openNotifications();
  }

  function bind() {
    const profileButton =
      $p('profileAvatarBtn');

    profileButton?.addEventListener(
      'click',
      () => setTimeout(
        openProfileExtras,
        0
      )
    );

    const form =
      $p('profileForm');

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
        event => {
          if (
            event.target.id === 'securityModal'
          ) {
            closeModal('securityModal');
          }
        }
      );

    $p('notificationsModal')
      ?.addEventListener(
        'click',
        event => {
          if (
            event.target.id === 'notificationsModal'
          ) {
            closeModal('notificationsModal');
          }
        }
      );

    $p('passwordOtpModal')
      ?.addEventListener(
        'click',
        event => {
          if (
            event.target.id === 'passwordOtpModal'
          ) {
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
        event => meter(
          event.target.value
        )
      );

    $p('passwordOtpInput')
      ?.addEventListener(
        'input',
        event => {
          event.target.value =
            event.target.value
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

  if (
    document.readyState === 'loading'
  ) {
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
