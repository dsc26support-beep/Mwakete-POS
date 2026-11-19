/* Google backend adapter.
 * The business owner must explicitly authorise the Google OAuth flow.
 * Do not put client secrets or service-account keys in this browser application.
 * A production provisioning service must create/assign the business spreadsheet and
 * Apps Script deployment, then save only the resulting Web App URL here.
 */
const GoogleBackend = {
  async configure(webAppUrl){
    const u=new URL(webAppUrl);
    if(u.protocol!=="https:" || u.hostname!=="script.google.com") throw new Error("Enter a valid HTTPS Google Apps Script Web App URL.");
    await POSDB.put("settings",{key:"apiUrl",value:u.href});
  },
  async sync(payload){
    const setting=await POSDB.get("settings","apiUrl");
    if(!setting?.value) return {configured:false};
    // Apps Script web apps commonly require no-cors for simple POST from browsers.
    // no-cors responses are opaque, so this adapter intentionally does not mark sales
    // synced on an opaque response. Use the documented authenticated relay/CORS endpoint.
    const response=await fetch(setting.value,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload),redirect:"follow"});
    if(!response.ok) throw new Error("Google backend returned HTTP "+response.status);
    return await response.json();
  }
};