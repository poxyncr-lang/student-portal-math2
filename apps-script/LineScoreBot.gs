/**
 * KruOh-LearnSpace — LINE score bot
 *
 * Deploy this file in the Apps Script project bound to the ปพ.5 spreadsheet.
 * It is intentionally kept in GitHub as the source of truth; never put LINE
 * channel secrets or access tokens in this repository.
 */

const BOT_SHEETS = {
  roster: '❇️01-รายชื่อ',
  attendance: '❇️02-เช็คชื่อ',
  scores: '❇️03-กรอกคะแนน',
  accounts: '🔒LINE_Accounts'
};

const BOT_ACCOUNT_HEADER_ROW = 4;
const BOT_SCORE_FIRST_ROW = 6;
const BOT_ATTENDANCE_HEADER_ROW = 3;
const BOT_ATTENDANCE_FIRST_ROW = 4;

/** LINE webhook entry point. */
function doPost(e) {
  const expectedKey = PropertiesService.getScriptProperties()
    .getProperty('BOT_WEBHOOK_KEY');
  if (expectedKey && (!e.parameter || e.parameter.key !== expectedKey)) {
    return ContentService.createTextOutput('forbidden');
  }

  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    (body.events || []).forEach(botHandleEvent_);
  } catch (error) {
    console.error(error);
  }
  return ContentService.createTextOutput('ok');
}

function botHandleEvent_(event) {
  if (!event || !event.replyToken || !event.source || !event.source.userId) return;
  const userId = event.source.userId;
  const replyToken = event.replyToken;

  if (event.type === 'postback') {
    const action = (event.postback && event.postback.data) || '';
    botHandleCommand_(replyToken, userId, action);
    return;
  }

  if (event.type !== 'message' || !event.message || event.message.type !== 'text') return;
  const text = botNormalize_(event.message.text);
  if (/^\d{5,}$/.test(text)) {
    botLinkStudent_(replyToken, userId, text);
    return;
  }
  botHandleCommand_(replyToken, userId, text);
}

function botHandleCommand_(replyToken, userId, command) {
  const normalized = botNormalize_(command).toLowerCase();
  if (!normalized || normalized === 'เริ่มต้น' || normalized === 'start' || normalized === 'menu' || normalized === 'เมนู') {
    botReply_(replyToken, [botWelcomeMessage_()]);
    return;
  }
  if (normalized === 'เช็กคะแนน' || normalized === 'คะแนน' || normalized === 'ผลการเรียน') {
    botReplyScore_(replyToken, userId);
    return;
  }
  if (normalized === 'รายละเอียดคะแนน') {
    botReplyScoreDetail_(replyToken, userId);
    return;
  }
  if (normalized === 'เวลาเรียน') {
    botReplyAttendance_(replyToken, userId);
    return;
  }
  if (normalized === 'วิธีใช้งาน' || normalized === 'ช่วยเหลือ') {
    botReplyText_(replyToken, 'พิมพ์ “เช็กคะแนน” เพื่อดูผลการเรียน\nหากยังไม่เคยเชื่อมบัญชี ให้พิมพ์รหัสนักเรียน 5 หลัก เช่น 37409\nเมื่อครูอนุมัติแล้วจึงใช้งานได้');
    return;
  }
  botReply_(replyToken, [botWelcomeMessage_()]);
}

function botWelcomeMessage_() {
  return {
    type: 'text',
    text: 'สวัสดีครับ 👋 KruOh-LearnSpace ช่วยเช็กผลการเรียนและเวลาเรียนได้\n\nพิมพ์ “เช็กคะแนน” เพื่อเริ่มต้น\nหากยังไม่เคยเชื่อมบัญชี ให้พิมพ์รหัสนักเรียน 5 หลัก',
    quickReply: {
      items: [
        botQuickReply_('เช็กคะแนน'),
        botQuickReply_('เวลาเรียน'),
        botQuickReply_('วิธีใช้งาน')
      ]
    }
  };
}

function botQuickReply_(text) {
  return { type: 'action', action: { type: 'message', label: text, text: text } };
}

function botLinkStudent_(replyToken, userId, studentId) {
  const student = botReadStudent_(studentId);
  if (!student) {
    botReplyText_(replyToken, 'ไม่พบรหัสนักเรียนนี้ในชีต ปพ.5 กรุณาตรวจสอบแล้วพิมพ์ใหม่อีกครั้ง');
    return;
  }

  const existing = botFindAccountByLine_(userId);
  if (existing && existing.status === 'active' && existing.studentId === studentId) {
    botReplyScore_(replyToken, userId);
    return;
  }

  const otherActive = botFindActiveAccountByStudent_(studentId);
  if (otherActive && otherActive.lineUserId !== userId) {
    botReplyText_(replyToken, 'รหัสนักเรียนนี้เชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อครูผู้ดูแล');
    return;
  }

  botUpsertPendingAccount_(studentId, userId);
  botReplyText_(replyToken, 'รับคำขอเชื่อมบัญชีของ ' + student.name + ' แล้ว ✅\nกรุณารอครูตรวจสอบและอนุมัติก่อนใช้งาน\nเมื่ออนุมัติแล้ว พิมพ์ “เช็กคะแนน” ได้ทันที');
}

function botReplyScore_(replyToken, userId) {
  const account = botFindAccountByLine_(userId);
  if (!account || account.status !== 'active') {
    botReply_(replyToken, [{
      type: 'text',
      text: 'บัญชี LINE นี้ยังไม่ได้รับอนุญาตให้ดูคะแนน\nกรุณาพิมพ์รหัสนักเรียน 5 หลักเพื่อส่งคำขอเชื่อมบัญชี',
      quickReply: { items: [botQuickReply_('วิธีใช้งาน')] }
    }]);
    return;
  }
  const student = botReadStudent_(account.studentId);
  if (!student) {
    botReplyText_(replyToken, 'ไม่พบข้อมูลนักเรียนในชีต ปพ.5 กรุณาติดต่อครูผู้ดูแล');
    return;
  }
  botReply_(replyToken, [botScoreFlex_(student)]);
}

function botReplyScoreDetail_(replyToken, userId) {
  const student = botReadActiveStudent_(userId);
  if (!student) return botReplyScore_(replyToken, userId);
  const s = student.score;
  const lines = [
    '📘 รายละเอียดคะแนน' + (s.courseCode ? ' (' + s.courseCode + ')' : ''),
    'ก่อนกลางภาค: K ' + s.preK + '/10 | P ' + s.preP + '/10 | A ' + s.preA + '/5',
    'รวมก่อนกลางภาค: ' + s.preTotal + '/25',
    'สอบกลางภาค: ' + s.midterm + '/20',
    'หลังกลางภาค: K ' + s.postK + '/10 | P ' + s.postP + '/10 | A ' + s.postA + '/5',
    'รวมหลังกลางภาค: ' + s.postTotal + '/25',
    'สอบปลายภาค: ' + s.finalExam + '/30',
    'คะแนนรวม: ' + s.total + ' | ผลการเรียน: ' + s.finalGrade
  ];
  botReply_(replyToken, [{ type: 'text', text: lines.join('\n'), quickReply: { items: [botQuickReply_('เช็กคะแนน'), botQuickReply_('เวลาเรียน')] } }]);
}

function botReplyAttendance_(replyToken, userId) {
  const student = botReadActiveStudent_(userId);
  if (!student) return botReplyScore_(replyToken, userId);
  const a = student.attendance;
  botReply_(replyToken, [{
    type: 'text',
    text: '🗓️ สรุปเวลาเรียนของ ' + student.name + '\nมาเรียน: ' + a.present + '\nลา: ' + a.leave + '\nขาด: ' + a.absent + '\nเวลาเรียน: ' + a.time + (a.status ? '\nสถานะ: ' + a.status : ''),
    quickReply: { items: [botQuickReply_('เช็กคะแนน'), botQuickReply_('รายละเอียดคะแนน')] }
  }]);
}

function botReadActiveStudent_(userId) {
  const account = botFindAccountByLine_(userId);
  return account && account.status === 'active' ? botReadStudent_(account.studentId) : null;
}

function botScoreFlex_(student) {
  const score = student.score;
  const attendance = student.attendance;
  return {
    type: 'flex',
    altText: 'ผลการเรียนของ ' + student.name + ': ' + score.total + ' คะแนน ผลการเรียน ' + score.finalGrade,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2C3E50', paddingAll: '18px',
        contents: [
          { type: 'text', text: 'KruOh-LearnSpace', color: '#FFFFFF', size: 'sm', weight: 'bold' },
          { type: 'text', text: 'ผลการเรียนของฉัน', color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'sm' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: student.name, weight: 'bold', size: 'lg', color: '#2C3E50', wrap: true },
          { type: 'text', text: student.room ? 'ห้อง ' + student.room : 'ข้อมูลนักเรียน', size: 'sm', color: '#7F8C8D' },
          { type: 'separator', margin: 'md' },
          botFlexPair_('คะแนนรวมทั้งหมด', String(score.total), '#2C3E50'),
          botFlexPair_('ผลการเรียน', String(score.finalGrade || '-'), '#E59B24'),
          botFlexPair_('มาเรียน', String(attendance.present), '#1ABC9C'),
          botFlexPair_('ขาด', String(attendance.absent), '#E74C3C')
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'button', style: 'primary', color: '#2C3E50', action: { type: 'message', label: 'รายละเอียดคะแนน', text: 'รายละเอียดคะแนน' } },
          { type: 'button', style: 'link', action: { type: 'message', label: 'ดูเวลาเรียน', text: 'เวลาเรียน' } }
        ]
      }
    }
  };
}

function botFlexPair_(label, value, color) {
  return {
    type: 'box', layout: 'baseline', contents: [
      { type: 'text', text: label, size: 'sm', color: '#7F8C8D', flex: 4 },
      { type: 'text', text: value, size: 'md', color: color, align: 'end', weight: 'bold', flex: 2 }
    ]
  };
}

function botReadStudent_(studentId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rosterRows = ss.getSheetByName(BOT_SHEETS.roster).getDataRange().getValues();
  const roster = botFindStudentRow_(rosterRows, studentId);
  if (!roster) return null;

  const scoreSheet = ss.getSheetByName(BOT_SHEETS.scores);
  const scoreRows = scoreSheet.getRange(BOT_SCORE_FIRST_ROW, 1, Math.max(scoreSheet.getLastRow() - BOT_SCORE_FIRST_ROW + 1, 1), scoreSheet.getLastColumn()).getValues();
  const scoreRow = botFindStudentRow_(scoreRows, studentId) || [];

  const attendanceSheet = ss.getSheetByName(BOT_SHEETS.attendance);
  const attendanceHeaders = attendanceSheet.getRange(BOT_ATTENDANCE_HEADER_ROW, 1, 1, attendanceSheet.getLastColumn()).getValues()[0];
  const attendanceRows = attendanceSheet.getRange(BOT_ATTENDANCE_FIRST_ROW, 1, Math.max(attendanceSheet.getLastRow() - BOT_ATTENDANCE_FIRST_ROW + 1, 1), attendanceSheet.getLastColumn()).getValues();
  const attendanceRow = botFindStudentRow_(attendanceRows, studentId) || [];

  return {
    studentId: studentId,
    name: botNameFromRoster_(roster),
    room: botValue_(roster, 5),
    attendance: {
      present: botValueByHeader_(attendanceHeaders, attendanceRow, 'มาเรียน'),
      leave: botValueByHeader_(attendanceHeaders, attendanceRow, 'ลา'),
      absent: botValueByHeader_(attendanceHeaders, attendanceRow, 'ขาด'),
      time: botValueByHeader_(attendanceHeaders, attendanceRow, 'เวลาเรียน'),
      status: botValueByHeader_(attendanceHeaders, attendanceRow, 'สถานะ')
    },
    score: {
      preK: botValue_(scoreRow, 6), preP: botValue_(scoreRow, 7), preA: botValue_(scoreRow, 8),
      preTotal: botValue_(scoreRow, 26), postK: botValue_(scoreRow, 9), postP: botValue_(scoreRow, 10),
      postA: botValue_(scoreRow, 11), postTotal: botValue_(scoreRow, 27), midterm: botValue_(scoreRow, 28),
      finalExam: botValue_(scoreRow, 29), total: botValue_(scoreRow, 30),
      finalGrade: botValue_(scoreRow, 33) || botValue_(scoreRow, 31), courseCode: botValue_(scoreRow, 34)
    }
  };
}

function botFindStudentRow_(rows, studentId) {
  const wanted = botNormalize_(studentId);
  return rows.find(function(row) { return botNormalize_(row[1]) === wanted; }) || null;
}

function botNameFromRoster_(row) {
  const parts = [botText_(row, 2), botText_(row, 3), botText_(row, 4)].filter(Boolean);
  return parts.join(' ') || 'นักเรียนรหัส ' + botText_(row, 1);
}

function botValueByHeader_(headers, row, keyword) {
  const index = headers.findIndex(function(header) { return botNormalize_(header).indexOf(keyword) !== -1; });
  return index === -1 ? '0' : botValue_(row, index);
}

function botValue_(row, index) {
  const value = row && row[index];
  return value === undefined || value === null || value === '' ? '0' : String(value);
}

function botText_(row, index) {
  return botNormalize_(row && row[index]);
}

function botFindAccountByLine_(lineUserId) {
  return botReadAccounts_().find(function(account) { return account.lineUserId === lineUserId; }) || null;
}

function botFindActiveAccountByStudent_(studentId) {
  return botReadAccounts_().find(function(account) { return account.studentId === studentId && account.status === 'active'; }) || null;
}

function botReadAccounts_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOT_SHEETS.accounts);
  const rows = sheet.getRange(BOT_ACCOUNT_HEADER_ROW + 1, 1, Math.max(sheet.getLastRow() - BOT_ACCOUNT_HEADER_ROW, 1), 5).getValues();
  return rows.map(function(row, index) {
    return { row: BOT_ACCOUNT_HEADER_ROW + 1 + index, studentId: botNormalize_(row[0]), lineUserId: botNormalize_(row[1]), status: botNormalize_(row[2]).toLowerCase() };
  }).filter(function(account) { return account.studentId && account.lineUserId; });
}

function botUpsertPendingAccount_(studentId, lineUserId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOT_SHEETS.accounts);
  const accounts = botReadAccounts_();
  const old = accounts.find(function(account) { return account.lineUserId === lineUserId; });
  const values = [[studentId, lineUserId, 'pending', new Date(), 'LINE Bot request']];
  if (old) sheet.getRange(old.row, 1, 1, 5).setValues(values);
  else sheet.getRange(Math.max(sheet.getLastRow() + 1, BOT_ACCOUNT_HEADER_ROW + 1), 1, 1, 5).setValues(values);
}

function botReplyText_(replyToken, text) {
  botReply_(replyToken, [{ type: 'text', text: text }]);
}

function botReply_(replyToken, messages) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('Missing LINE_CHANNEL_ACCESS_TOKEN script property');
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true
  });
}

function botNormalize_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

