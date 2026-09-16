/** Multi-course update: one identity, every score row, attendance keyed by exact room. */
function botCourseKey_(score) {
  return botNormalize_(score.courseCode).toLowerCase() + '|' + botNormalize_(score.room);
}

function botBuildStudents_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const roster = ss.getSheetByName(BOT_SHEETS.roster).getDataRange().getValues();
  const scoreSheet = ss.getSheetByName(BOT_SHEETS.scores);
  const meta = scoreSheet.getRange(1, 1, 2, 35).getValues();
  const rows = scoreSheet.getRange(BOT_SCORE_FIRST_ROW, 1, Math.max(scoreSheet.getLastRow()-BOT_SCORE_FIRST_ROW+1,1),35).getValues();
  const attendanceSheet = ss.getSheetByName(BOT_SHEETS.attendance);
  const attendanceRows = attendanceSheet.getDataRange().getValues();
  const headers = attendanceRows[BOT_ATTENDANCE_HEADER_ROW-1];
  const attendanceByKey = Object.create(null);
  attendanceRows.slice(BOT_ATTENDANCE_FIRST_ROW-1).forEach(function(row) {
    const key = botNormalize_(row[1]) + '|' + botNormalize_(row[5]);
    if (attendanceByKey[key]) throw new Error('ข้อมูลเวลาเรียนซ้ำ: เลขประจำตัวและห้องต้องไม่ซ้ำกัน');
    if (!/^\d{5,}$/.test(botNormalize_(row[1]))) return;
    attendanceByKey[key] = {
      present:botValueByHeader_(headers,row,'มาเรียน'), leave:botValueByHeader_(headers,row,'ลา'),
      absent:botValueByHeader_(headers,row,'ขาด'), time:botValueByHeader_(headers,row,'เวลาเรียน'),
      status:botValueByHeader_(headers,row,'สถานะ')
    };
  });
  const courseNames = Object.create(null);
  ss.getSheetByName('❇️00-ตั้งค่า').getRange('C18:D31').getValues().forEach(function(row) {
    courseNames[botNormalize_(row[0])] = botNormalize_(row[1]);
  });
  const students = Object.create(null);
  roster.forEach(function(row) {
    const id = botNormalize_(row[1]);
    if (!/^\d{5,}$/.test(id) || students[id]) return;
    students[id] = {studentId:id,name:botNameFromRoster_(row),room:botNormalize_(row[5]),scores:[]};
  });
  rows.forEach(function(row) {
    const id = botNormalize_(row[1]), student = students[id];
    if (!student) return;
    const room = botNormalize_(row[5]), courseCode = botNormalize_(row[34]);
    if (!courseCode || courseCode.charAt(0)==='#') throw new Error('มีแถวคะแนนที่ยังไม่มีรหัสวิชาที่ถูกต้องในคอลัมน์ AI');
    const score = {
      room:room, courseCode:courseCode, courseName:courseNames[courseCode] || '',
      preItems:botScoreItems_(meta[1],meta[0],row,6,15), postItems:botScoreItems_(meta[1],meta[0],row,16,25),
      preTotal:botValue_(row,26),postTotal:botValue_(row,27),midterm:botValue_(row,28),
      finalExam:botValue_(row,29),total:botValue_(row,30),finalGrade:botNormalize_(row[33]) || botNormalize_(row[31]) || '-',
      attendance:attendanceByKey[id+'|'+room] || null
    };
    if (student.scores.some(function(s){return botCourseKey_(s)===botCourseKey_(score);})) {
      throw new Error('ข้อมูลคะแนนซ้ำ: เลขประจำตัว ห้อง และรหัสวิชาต้องไม่ซ้ำกัน');
    }
    student.scores.push(score);
  });
  return Object.keys(students).map(function(id) {
    const student=students[id];
    student.score=student.scores[0] || {preItems:[],postItems:[],preTotal:'0',postTotal:'0',midterm:'0',finalExam:'0',total:'0',finalGrade:'-',courseCode:''};
    student.attendance=student.score.attendance || {present:'-',leave:'-',absent:'-',time:'-',status:''};
    student.room=student.score.room || student.room;
    return student;
  });
}

function botReadStudent_(studentId) {
  const cache=CacheService.getScriptCache(), key='multi-v1:'+botNormalize_(studentId);
  const cached=cache.get(key);
  if(cached) { try{return JSON.parse(cached);}catch(error){cache.remove(key);} }
  const student=botBuildStudents_().find(function(s){return s.studentId===botNormalize_(studentId);}) || null;
  if(student) cache.put(key,JSON.stringify(student),120);
  return student;
}

function botSyncDatabase_() {
  const properties=PropertiesService.getScriptProperties();
  const teacherId=properties.getProperty('BOT_TENANT_ID');
  const origin='https://kruoh-learnspace-line-bot.poxy-ncr.chatgpt.site';
  const key=properties.getProperty(teacherId?'BOT_TENANT_SYNC_KEY':'BOT_WEBHOOK_KEY');
  if(!key) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อม LINE Bot');
  if(teacherId) botImportTenantPendingAccounts_(teacherId,key);
  const students=botBuildStudents_();
  const accounts=botReadAccounts_().map(function(a){return {studentId:a.studentId,lineUserId:a.lineUserId,status:a.status};});
  const url=origin+(teacherId?'/api/tenant/'+encodeURIComponent(teacherId)+'/sync':'/api/sync');
  const response=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{'x-kruoh-sync-key':key},payload:JSON.stringify({students:students,accounts:accounts}),muteHttpExceptions:true});
  if(response.getResponseCode()!==200) throw new Error('ซิงก์ไม่สำเร็จ: '+response.getResponseCode());
  const result=JSON.parse(response.getContentText());
  result.courseCount=students.reduce(function(n,s){return n+s.scores.length;},0);
  CacheService.getScriptCache().removeAll(students.map(function(s){return 'multi-v1:'+s.studentId;}));
  SpreadsheetApp.getActiveSpreadsheet().toast('ซิงก์ '+students.length+' คน / '+result.courseCount+' รายการวิชาแล้ว','LINE Bot',5);
  console.log(JSON.stringify({studentCount:students.length,courseCount:result.courseCount,multiCourseCount:students.filter(function(s){return s.scores.length>1;}).length}));
  return result;
}

function verifyMultiCourse() {
  const students=botBuildStudents_();
  const report={studentCount:students.length,courseCount:0,multiCourseCount:0,missingAttendance:0};
  students.forEach(function(s){report.courseCount+=s.scores.length;if(s.scores.length>1)report.multiCourseCount++;s.scores.forEach(function(c){if(!c.attendance)report.missingAttendance++;});});
  console.log(JSON.stringify(report));
  return report;
}
