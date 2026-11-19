/**
 * Mwakete POS Google Apps Script backend starter.
 * Deploy as a Web App only after reviewing OAuth and access controls.
 * Each business must own its own Apps Script project and spreadsheet.
 * This template is NOT a complete production identity / provisioning service.
 */
const CONFIG = { SPREADSHEET_ID: "REPLACE_WITH_BUSINESS_OWNED_SPREADSHEET_ID", TOKEN_PROPERTY: "POS_SHARED_TOKEN" };
function doGet(){return json_({ok:true,service:"Mwakete POS Google backend",schemaVersion:1});}
function doPost(e){
  try{
    const body=JSON.parse((e.postData&&e.postData.contents)||"{}");
    // TODO production: validate signed identity, tenant ownership, schema and idempotency.
    // Never rely on a browser-supplied businessId or shared token as sole authorisation.
    if(body.type!=="pos_sync")throw new Error("Unsupported request.");
    const ids=saveTransactions_(body.transactions||[]);
    return json_({ok:true,acceptedIds:ids});
  }catch(err){return json_({ok:false,error:String(err.message||err)});}
}
function saveTransactions_(transactions){
  if(!Array.isArray(transactions)||transactions.length>100)throw new Error("Invalid batch.");
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let sh=ss.getSheetByName("Sales");
    if(!sh){sh=ss.insertSheet("Sales");sh.appendRow(["Transaction ID","Created At","Currency","Total","Payment Method","Items JSON"]);}
    const existing=sh.getLastRow()>1?new Set(sh.getRange(2,1,sh.getLastRow()-1,1).getValues().flat().map(String)):new Set();
    const accepted=[];
    transactions.forEach(t=>{
      if(!t||typeof t.id!=="string"||!Number.isFinite(Number(t.total))||!Array.isArray(t.items))throw new Error("Invalid transaction payload.");
      if(existing.has(t.id)){accepted.push(t.id);return;}
      sh.appendRow([t.id,new Date(Number(t.createdAt)),String(t.currency||""),Number(t.total),String(t.paymentMethod||""),JSON.stringify(t.items)]);
      existing.add(t.id);accepted.push(t.id);
    });
    return accepted;
  }finally{lock.releaseLock();}
}
function json_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
