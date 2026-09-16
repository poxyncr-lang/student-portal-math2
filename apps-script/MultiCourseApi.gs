/** Multi-course command routing; appended to LineBotApi in the bound project. */
function botMultiMessage_(student,input,userId) {
  const command=botNormalize_(input).toLowerCase();
  const match=command.match(/^(เช็กคะแนน|เช็คคะแนน|คะแนน|ผลการเรียน|รายละเอียดคะแนน|เวลาเรียน|ดูเวลาเรียน|ดูเวลา)(?:\s+(.+))?$/);
  const action=match ? (/เวลา/.test(match[1])?'เวลาเรียน':match[1]==='รายละเอียดคะแนน'?'รายละเอียดคะแนน':'คะแนน') : 'คะแนน';
  const requested=match ? botNormalize_(match[2]) : command;
  const scores=student.scores && student.scores.length?student.scores:[student.score];
  const cache=CacheService.getScriptCache(),key='course:'+userId+':'+student.studentId;
  let score;
  if(requested) {
    const parts=requested.split('|').map(function(s){return s.trim();});
    const found=scores.filter(function(s){return botNormalize_(s.courseCode).toLowerCase()===parts[0]&&(parts.length<2||s.room===parts[1]);});
    if(found.length===1){score=found[0];cache.put(key,botCourseKey_(score),21600);}
    else if(!match)return null;
  } else if(scores.length===1) score=scores[0];
  else if(action!=='คะแนน') {const selected=cache.get(key);score=scores.find(function(s){return botCourseKey_(s)===selected;});}
  if(!score) {
    const lines=['📚 เลือกรายวิชา','','👤 '+student.name,''];
    scores.forEach(function(s,i){lines.push((i+1)+') '+s.courseCode+' — '+(s.courseName||s.room));});
    lines.push('','แตะปุ่มด้านล่าง หรือพิมพ์รหัสวิชา');
    return {type:'text',text:lines.join('\n'),quickReply:{items:scores.slice(0,13).map(function(s){return {type:'action',action:{type:'message',label:s.courseCode,text:action+' '+s.courseCode+' | '+s.room}};})}};
  }
  const projected=Object.assign({},student,{score:score,room:score.room||student.room,attendance:score.attendance===undefined?student.attendance:score.attendance});
  const reply={items:[botQuickReply_('เช็กคะแนน'),botQuickReply_('รายละเอียดคะแนน'),botQuickReply_('เวลาเรียน')]};
  if(action==='รายละเอียดคะแนน')return {type:'text',text:botScoreDetailText_(projected),quickReply:reply};
  if(action==='เวลาเรียน') {
    const a=projected.attendance;
    return {type:'text',text:'🗓️ สรุปเวลาเรียนของ '+student.name+'\n📘 '+score.courseCode+' | ห้อง '+projected.room+'\n'+(a?'มาเรียน: '+a.present+'\nลา: '+a.leave+'\nขาด: '+a.absent+'\nเวลาเรียน: '+a.time+(a.status?'\nสถานะ: '+a.status:''):'ยังไม่มีข้อมูลเวลาเรียนของวิชานี้'),quickReply:reply};
  }
  projected.attendance=projected.attendance||{present:'-',absent:'-'};
  return {type:'text',text:'📘 '+score.courseCode+' | ห้อง '+projected.room+'\n'+botScoreSummaryText_(projected),quickReply:reply};
}

function botApiMessagesForText_(userId,text) {
  if(!userId)return [];
  if(/^\d{5,}$/.test(text))return botApiLinkMessages_(userId,text);
  const command=botNormalize_(text).toLowerCase();
  if(command==='วิธีใช้งาน'||command==='ช่วยเหลือ')return [botWelcomeMessage_()];
  const student=botReadActiveStudent_(userId);
  if(student){const message=botMultiMessage_(student,command,userId);if(message)return [message];}
  if(/^(เช็กคะแนน|เช็คคะแนน|คะแนน|ผลการเรียน|รายละเอียดคะแนน|เวลาเรียน|ดูเวลา)/.test(command))return botApiScoreMessages_(userId);
  return [botWelcomeMessage_()];
}

function botApiScoreMessages_(userId) {
  const student=botReadActiveStudent_(userId);
  return student?[botMultiMessage_(student,'เช็กคะแนน',userId)]:[{type:'text',text:'บัญชี LINE นี้ยังไม่ได้รับอนุญาตให้ดูคะแนน\nกรุณาพิมพ์รหัสนักเรียน 5 หลักเพื่อส่งคำขอเชื่อมบัญชี'}];
}

function botHandleCommand_(replyToken,userId,command) {
  botReply_(replyToken,botApiMessagesForText_(userId,command));
}
