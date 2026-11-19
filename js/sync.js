const POSSynchroniser = {
  running:false,
  async run(){
    if(this.running) return; this.running=true;
    try{
      const pending=(await POSDB.all("sales")).filter(s=>s.syncStatus!=="synced");
      if(!pending.length){setSyncUI("All changes saved","No pending sales.");return;}
      const result=await GoogleBackend.sync({type:"pos_sync",schemaVersion:1,transactions:pending});
      if(result?.acceptedIds && Array.isArray(result.acceptedIds)){
        for(const sale of pending) if(result.acceptedIds.includes(sale.id)){sale.syncStatus="synced";await POSDB.put("sales",sale);}
        setSyncUI("Sync complete",`${result.acceptedIds.length} sale(s) synchronised.`);
      }else throw new Error("Backend did not confirm accepted transaction IDs.");
    }catch(e){setSyncUI("Sync needs attention",e.message);throw e;}
    finally{this.running=false;}
  }
};
function setSyncUI(title,detail){const a=document.getElementById("syncStatus"),b=document.getElementById("syncDetail");if(a)a.textContent=title;if(b)b.textContent=detail;}
