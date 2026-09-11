/**
 * HTTP adapter for the hosted LINE webhook.
 *
 * The web app itself only accepts GET requests after Google's redirect. The
 * hosted webhook validates LINE's signature, then calls this adapter with a
 * short-lived secret stored outside the repository.
 */
function botHttpApi_(e) {
  const parameter = (e && e.parameter) || {};
  if (parameter.api !== 'line-bot') return null;

  const expectedKey = PropertiesService.getScriptProperties()
    .getProperty('BOT_WEBHOOK_KEY');
  if (!expectedKey || parameter.key !== expectedKey) {
    return ContentService.createTextOutput(JSON.stringify({ messages: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const messages = botApiMessagesForText_(
    botNormalize_(parameter.line_user_id),
    botNormalize_(parameter.text),
  );
  return ContentService.createTextOutput(JSON.stringify({ messages: messages }))
    .setMimeType(ContentService.MimeType.JSON);
}

function botApiMessagesForText_(userId, text) {
  if (!userId) return [];
  if (/^\d{5,}$/.test(text)) return botApiLinkMessages_(userId, text);

  const command = botNormalize_(text).toLowerCase();
  if (!command || command === 'เริ่มต้น' || command === 'start' || command === 'menu' || command === 'เมนู') {
    return [botWelcomeMessage_()];
  }
  if (command === 'เช็กคะแนน' || command === 'คะแนน' || command === 'ผลการเรียน') {
    return botApiScoreMessages_(userId);
  }
  if (command === 'รายละเอียดคะแนน') return botApiDetailMessages_(userId);
  if (command === 'เวลาเรียน') return botApiAttendanceMessages_(userId);
  if (command === 'วิธีใช้งาน' || command === 'ช่วยเหลือ') {
    return [{
      type: 'text',
      text: 'พิมพ์ “เช็กคะแนน” เพื่อดูผลการเรียน\nหากยังไม่เคยเชื่อมบัญชี ให้พิมพ์รหัสนักเรียน 5 หลัก เช่น 37409\nเมื่อครูอนุมัติแล้วจึงใช้งานได้'
    }];
  }
  return [botWelcomeMessage_()];
}

function botApiLinkMessages_(userId, studentId) {
  const student = botReadStudent_(studentId);
  if (!student) return [{
    type: 'text', text: 'ไม่พบรหัสนักเรียนนี้ในชีต ปพ.5 กรุณาตรวจสอบแล้วพิมพ์ใหม่อีกครั้ง'
  }];

  const existing = botFindAccountByLine_(userId);
  if (existing && existing.status === 'active' && existing.studentId === studentId) {
    return botApiScoreMessages_(userId);
  }
  const otherActive = botFindActiveAccountByStudent_(studentId);
  if (otherActive && otherActive.lineUserId !== userId) return [{
    type: 'text', text: 'รหัสนักเรียนนี้เชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อครูผู้ดูแล'
  }];

  botUpsertPendingAccount_(studentId, userId);
  return [{
    type: 'text',
    text: 'รับคำขอเชื่อมบัญชีของ ' + student.name + ' แล้ว ✅\nกรุณารอครูตรวจสอบและอนุมัติก่อนใช้งาน\nเมื่ออนุมัติแล้ว พิมพ์ “เช็กคะแนน” ได้ทันที'
  }];
}

function botApiScoreMessages_(userId) {
  const account = botFindAccountByLine_(userId);
  if (!account || account.status !== 'active') return [{
    type: 'text',
    text: 'บัญชี LINE นี้ยังไม่ได้รับอนุญาตให้ดูคะแนน\nกรุณาพิมพ์รหัสนักเรียน 5 หลักเพื่อส่งคำขอเชื่อมบัญชี',
    quickReply: { items: [botQuickReply_('วิธีใช้งาน')] }
  }];
  const student = botReadStudent_(account.studentId);
  return student
    ? [botScoreFlex_(student)]
    : [{ type: 'text', text: 'ไม่พบข้อมูลนักเรียนในชีต ปพ.5 กรุณาติดต่อครูผู้ดูแล' }];
}

function botApiDetailMessages_(userId) {
  const student = botReadActiveStudent_(userId);
  if (!student) return botApiScoreMessages_(userId);
  return [{
    type: 'text',
    text: botScoreDetailText_(student),
    quickReply: { items: [botQuickReply_('เช็กคะแนน'), botQuickReply_('เวลาเรียน')] }
  }];
}

function botApiAttendanceMessages_(userId) {
  const student = botReadActiveStudent_(userId);
  if (!student) return botApiScoreMessages_(userId);
  const a = student.attendance;
  return [{
    type: 'text',
    text: '🗓️ สรุปเวลาเรียนของ ' + student.name + '\nมาเรียน: ' + a.present + '\nลา: ' + a.leave + '\nขาด: ' + a.absent + '\nเวลาเรียน: ' + a.time + (a.status ? '\nสถานะ: ' + a.status : ''),
    quickReply: { items: [botQuickReply_('เช็กคะแนน'), botQuickReply_('รายละเอียดคะแนน')] }
  }];
}
