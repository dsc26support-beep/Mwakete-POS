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
    if(!sh){sh=ss.insertSheet("Sales");sh.appendRow(HEADER);}else if(sh.getLastColumn()<HEADER.length){sh.getRange(1,1,1,HEADER.length).setValues([HEADER]);}
    const existing=sh.getLastRow()>1?new Set(sh.getRange(2,1,sh.getLastRow()-1,1).getValues().flat().map(String)):new Set();
    const accepted=[];
    transactions.forEach(t=>{
      validateTransaction_(t);
      if(existing.has(t.id)){accepted.push(t.id);return;}
      sh.appendRow([t.id,new Date(Number(t.createdAt)),String(t.currency||""),Number(t.total),String(t.paymentMethod||""),JSON.stringify(t.items),t.discount?Number(t.discount.amount):0,String(t.customerId||""),String(t.tier||"counter")]);
      existing.add(t.id);accepted.push(t.id);
    });
    return accepted;
  }finally{lock.releaseLock();}
}
const HEADER=["Transaction ID","Created At","Currency","Total","Payment Method","Items JSON","Discount","Customer ID","Tier"];
/* Never trust client-computed money. Recompute in integer cents: total must equal sum(unitPrice*quantity) - discount. */
function validateTransaction_(t){
  if(!t||typeof t.id!=="string"||!t.id||t.id.length>100||!Array.isArray(t.items)||!t.items.length||t.items.length>200)throw new Error("Invalid transaction payload.");
  let subtotal=0;
  t.items.forEach(function(it){
    const q=Number(it&&it.quantity),p=Number(it&&it.unitPrice);
    if(!Number.isInteger(q)||q<1||q>100000||!Number.isFinite(p)||p<0)throw new Error("Invalid line item.");
    subtotal+=Math.round(p*100)*q;
  });
  let discount=0;
  if(t.discount!==undefined&&t.discount!==null){
    const a=Number(t.discount.amount);
    if(!Number.isFinite(a)||a<0)throw new Error("Invalid discount.");
    discount=Math.round(a*100);
    if(discount>subtotal)throw new Error("Discount exceeds the sale subtotal.");
  }
  const total=Math.round(Number(t.total)*100);
  if(!Number.isFinite(total)||total!==subtotal-discount)throw new Error("Total does not match items and discount.");
}
function json_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
