/** Sheet1 -> existing authenticated Worker SMS endpoint. Telegram is untouched. */
var D1_SYNC_URL_ = 'https://personal-finance-new.haribhaskarann.workers.dev/api/ingest/sms';
var D1_SYNC_SHEET_ID_ = '1rRUFREc1_aZ6_Azh-RU3YNOn0Go-RFMr6FMW-4iBLY4';
var D1_SYNC_HEADERS_ = ['Source row', 'External ID', 'Received at', 'Status', 'Attempts', 'Last attempt', 'SMS ID', 'Transaction ID', 'Parse status', 'Delivery note'];

/** Run once AFTER adding D1_SMS_INGEST_TOKEN in Script Properties.
 * Starts with FUTURE rows only; does not import existing history.
 * This is a standalone timer: no web-app redeployment is needed.
 */
function installD1Sync() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('D1_SMS_INGEST_TOKEN');
    if (!token) throw new Error('Add D1_SMS_INGEST_TOKEN in Script Properties first.');
    // Non-financial check: the Worker ignores this without storing a transaction.
    var check = d1PostSms_(token, {message: 'D1 sync authorization check', receivedAt: new Date().toISOString()});
    if (!check.ok || !check.data.ignored) throw new Error('Worker authorization check failed: ' + check.note);
    var ss = SpreadsheetApp.openById(D1_SYNC_SHEET_ID_);
    var source = ss.getSheetByName('Sheet1');
    if (!source) throw new Error('Sheet1 was not found.');
    d1CheckSourceHeaders_(source);
    d1SyncLog_(ss);
    if (!props.getProperty('D1_SYNC_NEXT_ROW')) props.setProperty('D1_SYNC_NEXT_ROW', String(source.getLastRow() + 1));
    var triggers = ScriptApp.getProjectTriggers().filter(function(t) {return t.getHandlerFunction() === 'syncSheetTransactionsToD1';});
    if (!triggers.length) ScriptApp.newTrigger('syncSheetTransactionsToD1').timeBased().everyMinutes(1).create();
    console.log('D1 sync installed. Next source row: ' + props.getProperty('D1_SYNC_NEXT_ROW'));
  } finally {lock.releaseLock();}
}

function syncSheetTransactionsToD1() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('D1_SMS_INGEST_TOKEN');
    var next = Number(props.getProperty('D1_SYNC_NEXT_ROW'));
    if (!token || !Number.isInteger(next) || next < 2) throw new Error('Configure the token and run installD1Sync first.');
    var ss = SpreadsheetApp.openById(D1_SYNC_SHEET_ID_);
    var source = ss.getSheetByName('Sheet1');
    d1CheckSourceHeaders_(source);
    var log = d1SyncLog_(ss);
    var last = source.getLastRow();
    if (last < next - 1) throw new Error('Source rows were removed. Stop and review the D1 cursor before continuing.');
    // Commit queue rows before moving the cursor. A crash may enqueue a repeat,
    // but its deterministic external ID makes the Worker retry idempotent.
    var count = Math.min(100, Math.max(0, last - next + 1));
    if (count) {
      var rows = source.getRange(next, 1, count, 13).getValues();
      var queued = rows.map(function(row, i) {
        if (String(row[12]).trim() !== 'Transactional') return [next+i, '', '', 'SKIPPED', 0, '', '', '', '', 'Not classified as Transactional'];
        try {
          var at = d1ReceivedAt_(row[0], ss.getSpreadsheetTimeZone());
          var id = d1ExternalId_(String(row[1] || ''), String(row[2] || ''), at);
          return [next+i, id, at, 'QUEUED', 0, '', '', '', '', ''];
        } catch (e) {return [next+i, '', '', 'INVALID_DATE', 0, '', '', '', '', 'Source date is invalid; correct it, then requeue this row.'];}
      });
      log.getRange(log.getLastRow()+1, 1, queued.length, 10).setValues(queued);
      SpreadsheetApp.flush();
      props.setProperty('D1_SYNC_NEXT_ROW', String(next+count));
    }
    if (log.getLastRow() < 2) return;
    var jobs = log.getRange(2, 1, log.getLastRow()-1, 10).getValues();
    var attempts = 0;
    for (var i=0; i<jobs.length && attempts<25; i++) {
      var job = jobs[i];
      if (job[3] !== 'QUEUED' && job[3] !== 'RETRY') continue;
      var prior = Number(job[4]) || 0;
      var delay = Math.min(60, Math.pow(2, Math.min(prior, 6))) * 60000;
      if (job[3] === 'RETRY' && job[5] && Date.now()-new Date(job[5]).getTime() < delay) continue;
      var row = source.getRange(Number(job[0]), 1, 1, 13).getValues()[0];
      var unchanged = false;
      try {unchanged = d1ExternalId_(String(row[1] || ''), String(row[2] || ''), d1ReceivedAt_(row[0], ss.getSpreadsheetTimeZone())) === job[1];} catch (e) {}
      if (!unchanged || String(row[12]).trim() !== 'Transactional') {
        job[3]='SOURCE_CHANGED'; job[9]='Source row changed or moved; review before requeueing.';
        log.getRange(i+2,1,1,10).setValues([job]); continue;
      }
      attempts++;
      var result = d1PostSms_(token, {externalId:job[1],sender:String(row[1] || ''),message:String(row[2] || ''),receivedAt:job[2]});
      job[3] = result.ok ? result.data.ignored ? 'IGNORED' : result.data.transactionId ? 'SENT' : 'NEEDS_REVIEW' : 'RETRY';
      job[4]=prior+1; job[5]=new Date();
      job[6]=result.ok ? result.data.smsMessageId || '' : '';
      job[7]=result.ok ? result.data.transactionId || '' : '';
      job[8]=result.ok ? result.data.parseStatus || '' : '';
      job[9]=result.ok ? result.data.ignored ? 'Worker classified as non-financial' : result.data.duplicate ? 'Already received by D1' : 'Received by D1' : result.note;
      log.getRange(i+2,1,1,10).setValues([job]);
      if (result.authError) break;
    }
  } finally {lock.releaseLock();}
}

function d1SyncLog_(ss) {
  var sheet = ss.getSheetByName('D1 Sync');
  if (!sheet) {sheet=ss.insertSheet('D1 Sync'); sheet.getRange(1,1,1,10).setValues([D1_SYNC_HEADERS_]); sheet.setFrozenRows(1);}
  var headers=sheet.getRange(1,1,1,10).getValues()[0];
  if (headers.join('|') !== D1_SYNC_HEADERS_.join('|')) throw new Error('D1 Sync headers differ from the expected delivery log.');
  return sheet;
}

function d1CheckSourceHeaders_(sheet) {
  if (!sheet) throw new Error('Sheet1 was not found.');
  var h=sheet.getRange(1,1,1,13).getValues()[0];
  if (h[0]!=='Received Date' || h[1]!=='Sender' || h[2]!=='Sms body' || h[12]!=='Message Type') throw new Error('Sheet1 column layout changed; review before syncing.');
}

function d1ReceivedAt_(value, zone) {
  var date;
  if (value instanceof Date) date=value;
  else if (typeof value==='string' && /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}:\d{2}$/.test(value.trim())) date=Utilities.parseDate(value.trim().replace('T',' '),zone,'yyyy-MM-dd H:mm:ss');
  else if (typeof value==='string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())) date=new Date(value.trim());
  if (!date || !Number.isFinite(date.getTime())) throw new Error('Invalid SMS received date.');
  return date.toISOString();
}

function d1ExternalId_(sender, message, receivedAt) {
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify([D1_SYNC_SHEET_ID_,sender,message,receivedAt]),Utilities.Charset.UTF_8);
  return 'sheets:' + bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}

function d1PostSms_(token, payload) {
  try {
    var response=UrlFetchApp.fetch(D1_SYNC_URL_,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify(payload),muteHttpExceptions:true,followRedirects:false});
    var status=response.getResponseCode(), json;
    try {json=JSON.parse(response.getContentText());} catch(e) {return {ok:false,note:'HTTP '+status+': invalid JSON response',authError:status===401||status===403};}
    if (status>=200 && status<300 && json.success===true && json.data && (json.data.ignored===true || typeof json.data.smsMessageId==='string')) return {ok:true,data:json.data};
    // Do not write server bodies, tokens or SMS content to the log.
    return {ok:false,note:'HTTP '+status+': delivery not acknowledged',authError:status===401||status===403};
  } catch(e) {return {ok:false,note:'Network request failed; retry scheduled',authError:false};}
}
