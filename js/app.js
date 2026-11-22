let products=[],cart=[];
const $=id=>document.getElementById(id);
const money=n=>Number(n||0).toFixed(2);
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2400)}
function uid(){return crypto.randomUUID?crypto.randomUUID():"pos-"+Date.now()+"-"+Math.random().toString(16).slice(2)}
async function refresh(){
 products=await POSDB.all("products");renderProducts();renderCart();renderProductTable();renderSales();
 const settings=await POSDB.all("settings");const map=Object.fromEntries(settings.map(x=>[x.key,x.value]));
 $("settingsForm").elements.businessName.value=map.businessName||"";
 $("settingsForm").elements.currency.value=map.currency||"AUD";
 $("settingsForm").elements.apiUrl.value=map.apiUrl||"";
 if(window.RetailUI)await RetailUI.render();
}
function renderProducts(){
 const q=$("productSearch").value.toLowerCase().trim(),items=products.filter(p=>(p.name+" "+(p.sku||"")).toLowerCase().includes(q));
 $("productGrid").innerHTML=items.map(p=>`<button class="product-card" data-add="${p.id}"><strong>${esc(p.name)}</strong><span>${money(p.price)}</span><small>${p.stock} in stock</small></button>`).join("");
 $("emptyProducts").classList.toggle("hidden",products.length>0);
 if(window.WholesaleUI)WholesaleUI.afterProducts();
}
function renderCart(){
 $("cartCount").textContent=cart.reduce((n,x)=>n+x.qty,0);
 $("cartItems").innerHTML=cart.length?cart.map(x=>`<div class="cart-line"><div><strong>${esc(x.name)}</strong><small>${money(x.price)} × ${x.qty}</small></div><div class="qty"><button data-dec="${x.id}" aria-label="Decrease">−</button><b>${money(x.price*x.qty)}</b><button data-inc="${x.id}" aria-label="Increase">+</button></div></div>`).join(""):'<p class="empty">Your cart is empty.</p>';
 const total=cart.reduce((n,x)=>n+x.price*x.qty,0);$("subtotal").textContent=money(total);$("total").textContent=money(total);$("checkout").disabled=!cart.length;if(window.RetailUI)RetailUI.afterCart(cart);
 $("checkout").textContent=$("paymentMethod").value==="cash"?"Complete cash sale":$("paymentMethod").value==="account"?"Create invoice (on account)":"Record payment (unverified)";
}
function renderProductTable(){$("productTable").innerHTML=products.length?`<table><thead><tr><th>Product</th><th>SKU / barcode</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>${products.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.sku||"—")}</td><td>${money(p.price)}</td><td>${p.stock}</td><td><button class="text-button" data-delete="${p.id}">Remove</button></td></tr>`).join("")}</tbody></table>`:'<p class="empty">No products added yet.</p>'}
async function renderSales(){const sales=(await POSDB.all("sales")).sort((a,b)=>b.createdAt-a.createdAt);$("salesList").innerHTML=sales.length?sales.map(s=>`<div class="sale-row" data-sale-id="${esc(s.id)}"><div><strong>${esc(s.id.slice(0,18))}</strong><small>${new Date(s.createdAt).toLocaleString()} · ${s.paymentMethod} · ${s.syncStatus}</small></div><strong>${money(s.total)}</strong></div>`).join(""):'<p class="empty">No sales recorded yet.</p>'}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
document.addEventListener("click",async e=>{
 const add=e.target.closest("[data-add]");if(add){const p=products.find(x=>x.id===add.dataset.add);if(p){const line=cart.find(x=>x.id===p.id);if(line)line.qty++;else cart.push(window.WholesaleUI?WholesaleUI.line(p):{...p,qty:1});renderCart()}return}
 const inc=e.target.closest("[data-inc]");if(inc){const x=cart.find(x=>x.id===inc.dataset.inc);if(x)x.qty++;renderCart();return}
 const dec=e.target.closest("[data-dec]");if(dec){const x=cart.find(x=>x.id===dec.dataset.dec);if(x&&--x.qty<=0)cart=cart.filter(y=>y.id!==x.id);renderCart();return}
 const del=e.target.closest("[data-delete]");if(del){await POSDB.remove("products",del.dataset.delete);await refresh();toast("Product removed");return}
 const tab=e.target.closest("[data-view]");if(tab){document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===tab));document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));$("view-"+tab.dataset.view).classList.remove("hidden")}
});
$("productForm").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget),name=String(f.get("name")).trim(),price=Number(f.get("price")),stock=Number(f.get("stock"));if(!name||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0)return toast("Check product details.");const ex=window.RetailUI?RetailUI.productExtras(f):{};if(!ex)return;await POSDB.put("products",{id:uid(),name,price,stock,sku:String(f.get("sku")||"").trim(),updatedAt:Date.now(),...ex});$("productForm").reset();await refresh();toast("Product saved on this device.")});
$("checkout").addEventListener("click",async()=>{
 if(!cart.length)return;
 const method=$("paymentMethod").value;
 if(method!=="cash"&&method!=="account"&&!confirm("This records a payment method only. It does NOT verify that a digital payment succeeded. Continue?"))return;
 const total=cart.reduce((n,x)=>n+x.price*x.qty,0),sale={id:uid(),createdAt:Date.now(),currency:(await POSDB.get("settings","currency"))?.value||"AUD",items:cart.map(x=>({productId:x.productId||x.id,name:x.name,sku:x.sku,unitPrice:x.price,quantity:x.qty,...(x.packId?{packId:x.packId,packUnits:x.packUnits}:{})})),total,paymentMethod:method,paymentVerified:method==="cash",syncStatus:"pending"};
 if(window.RetailUI&&!await RetailUI.decorateSale(sale,cart))return;
 await POSDB.put("sales",sale);
 for(const line of cart){const p=products.find(x=>x.id===(line.productId||line.id));if(p){p.stock=Math.max(0,p.stock-line.qty*(line.packUnits||1));await POSDB.put("products",p)}}
 cart=[];await refresh();toast("Sale saved. Receipt ID: "+sale.id);if(window.RetailUI)RetailUI.afterSale(sale);
});
$("clearCart").addEventListener("click",()=>{cart=[];renderCart()});
$("productSearch").addEventListener("input",renderProducts);
$("paymentMethod").addEventListener("change",renderCart);
$("settingsForm").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await POSDB.put("settings",{key:"businessName",value:String(f.get("businessName")).trim()});await POSDB.put("settings",{key:"currency",value:String(f.get("currency")).trim().toUpperCase()});const url=String(f.get("apiUrl")||"").trim();if(url)try{await GoogleBackend.configure(url)}catch(err){toast(err.message);return}else await POSDB.remove("settings","apiUrl");toast("Settings saved.");});
$("syncNow").addEventListener("click",async()=>{try{await POSSynchroniser.run()}catch(e){toast("Sync not completed: "+e.message)}});
function connection(){const online=navigator.onLine;$("onlineDot").classList.toggle("online",online);$("connectionText").textContent=online?"Internet available":"Offline mode";if(!online)setSyncUI("Working offline","Sales remain saved on this device.");}
window.addEventListener("online",()=>{connection();POSSynchroniser.run().catch(()=>{})});window.addEventListener("offline",connection);
(async()=>{await POSDB.open();$("year").textContent=new Date().getFullYear();await refresh();await TierUI.init();await RetailUI.init();await WholesaleUI.init();await InvoiceUI.init();await HelpCentre.init();connection();if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.error)})();
