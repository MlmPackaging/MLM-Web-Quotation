const $=id=>document.getElementById(id); const bagGrid=$('bagGrid'); let optionsLoaded=false;
const bags=Array.from({length:16},(_,i)=>{const n=i+1;const white=n<=8;const cup=n===1||n===9?'2-cup':n===2||n===10?'4-cup':'';return {n,white,cup,h:320,w:(n===1||n===9)?200:(n===2||n===10)?250:320,g:(n===1||n===9)?120:(n===2||n===10)?180:115,material:white?'White Kraft 100 gsm':'Recycled Kraft 120 gsm'}});
let selected=1;
const previewSources=new Map();
function previewGeometry(h,w,g){
  const scale=Math.min(62/(w+g*.70),72/(h+w*.25+g*.45));
  const front=w*scale, depth=g*.70*scale, body=h*scale, handles=w*.25*scale, opening=g*.45*scale;
  return {left:20+(62-front-depth)/2,top:8+(72-body-handles-opening)/2,front,depth,body,handles,opening};
}
function reshapeBag(){
  const h=Number($('height').value),w=Number($('width').value),g=Number($('gusset').value);
  if(![h,w,g].every(v=>Number.isFinite(v)&&v>0))return;
  const n=selected,card=document.querySelector('.bag.active');
  if(!previewSources.has(n)){
    const source=new Image();previewSources.set(n,source);
    source.onload=()=>{if(selected===n)reshapeBag()};
    source.src=embeddedBagImages['bag-'+String(n).padStart(2,'0')+'.webp'];
  }
  const source=previewSources.get(n);
  if(!source.complete||!source.naturalWidth)return;
  const box=previewGeometry(h,w,g);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=600;
  const ctx=canvas.getContext('2d');ctx.scale(6,6);
  // Scale the mouth independently: the top-left rim extends with gusset depth.
  // Source anchors are normalised to the 360px catalogue images.
  const sx=[55,268,310],sy=[0,70,105,342];
  const dx=[box.left,box.left+box.front,box.left+box.front+box.depth];
  const dy=[box.top,box.top+box.handles,box.top+box.handles+box.opening,box.top+box.handles+box.opening+box.body];
  // A continuous mesh keeps handles, attachment patches and shadows together.
  const catalogue=bags[n-1];
  const extraDepth=Math.max(0,box.depth-box.front*catalogue.g/catalogue.w*.70);
  const handleShift=Math.min(extraDepth*.28,box.front*.12);
  const rimSamples=[[85,91],[85,90],[83,89],[82,89],[76,85],[77,85],[74,82],[70,81],
    [81,87],[82,88],[77,84],[77,84],[73,87],[75,87],[74,87],[75,87]];
  const [rimLeft,rimRight]=rimSamples[n-1];
  const rimY=x=>rimLeft+(x-100)*(rimRight-rimLeft)/180;
  const baseX=x=>x<=268?box.left+(x-55)/213*box.front:dx[1]+(x-268)/42*box.depth;
  const baseY=y=>{const band=y<70?0:y<105?1:2;return dy[band]+(y-sy[band])/(sy[band+1]-sy[band])*(dy[band+1]-dy[band]);};
  const shiftX=x=>x<95?Math.max(0,(x-55)/40):x<=235?1:x<268?(268-x)/33:0;
  const upperX=x=>baseX(x)+handleShift*shiftX(x);
  const rimStart=upperX(100),rimEnd=upperX(310);
  function meshPoint(x,y){
    // Carry the displacement past all handle feet; blend only below them.
    const fade=y<=145?1:Math.max(0,1-(y-145)/45);
    const px=baseX(x)+handleShift*shiftX(x)*fade;
    const straightRim=baseY(rimY(100))+(upperX(x)-rimStart)/(rimEnd-rimStart)*(baseY(rimY(310))-baseY(rimY(100)));
    const correction=straightRim-baseY(rimY(x));
    const weight=y<=rimY(x)?Math.max(0,y/rimY(x)):Math.max(0,(190-y)/(190-rimY(x)));
    return [px,baseY(y)+correction*weight];
  }
  function triangle(src,dst){
    const [a,b,c]=src,[u,v,w]=dst;
    const det=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
    const aa=((v[0]-u[0])*(c[1]-a[1])-(w[0]-u[0])*(b[1]-a[1]))/det;
    const cc=((w[0]-u[0])*(b[0]-a[0])-(v[0]-u[0])*(c[0]-a[0]))/det;
    const bb=((v[1]-u[1])*(c[1]-a[1])-(w[1]-u[1])*(b[1]-a[1]))/det;
    const dd=((w[1]-u[1])*(b[0]-a[0])-(v[1]-u[1])*(c[0]-a[0]))/det;
    ctx.save();ctx.beginPath();ctx.moveTo(...u);ctx.lineTo(...v);ctx.lineTo(...w);ctx.closePath();ctx.clip();
    ctx.transform(aa,bb,cc,dd,u[0]-aa*a[0]-cc*a[1],u[1]-bb*a[0]-dd*a[1]);
    ctx.drawImage(source,0,0);ctx.restore();
  }
  const columns=[55,75,95,100,120,140,160,180,200,220,235,250,268,280,295,310];
  const rows=x=>[0,35,55,Math.min(70,rimY(x)-1),rimY(x),105,125,145,170,190,240,290,342];
  for(let col=0;col<columns.length-1;col++){
    const x=columns[col],nextX=columns[col+1],ys=rows(x),nextYs=rows(nextX);
    for(let row=0;row<ys.length-1;row++){
      const a=[x,ys[row]],b=[nextX,nextYs[row]],c=[nextX,nextYs[row+1]],d=[x,ys[row+1]];
      triangle([a,b,c],[meshPoint(...a),meshPoint(...b),meshPoint(...c)]);
      triangle([a,c,d],[meshPoint(...a),meshPoint(...c),meshPoint(...d)]);
    }
  }
  const url=canvas.toDataURL('image/png');
  const photo=card.querySelector('.bag-photo');photo.style.padding='0';photo.src=url;
  $('selectedPhoto').src=url;
  const labels=card.querySelectorAll('.dimension-overlay text');
  const positions=[
    [box.left-5,box.top+box.handles+box.opening+box.body/2,-90],
    [box.left+box.front/2,dy[3]+5,0],
    [dx[2]+4,dy[3]-2,-55]
  ];
  labels.forEach((label,i)=>{
    const [x,y,angle]=positions[i];
    label.setAttribute('x',x);label.setAttribute('y',y);
    label.setAttribute('transform','rotate('+angle+' '+x+' '+y+')');
  });
}
bags.forEach(b=>{const el=document.createElement('button');el.type='button';el.className='bag '+(b.white?'white':'kraft')+(b.n===1?' active':'');el.dataset.n=b.n;const img=embeddedBagImages['bag-'+String(b.n).padStart(2,'0')+'.webp'];el.innerHTML='<span class="bag-visual"><img class="bag-photo" src="'+img+'" alt="Bag '+b.n+' printed sample" loading="lazy"><svg class="dimension-overlay" viewBox="0 0 100 100" aria-hidden="true"><text x="22" y="54" transform="rotate(-90 22 54)">'+b.h+' mm</text><text x="51" y="85">'+b.w+'</text><text x="83" y="82" transform="rotate(-55 83 82)">'+b.g+'</text></svg></span><span class="bag-copy"><strong>Bag '+b.n+'</strong><span class="material-badge">'+(b.white?'White':'Recycled')+' Kraft</span></span><small>'+(b.cup||'Printed sample')+'</small>';el.setAttribute('aria-label','Bag '+b.n+', '+b.h+' by '+b.w+' by '+b.g+' millimetres, '+b.material);el.onclick=()=>selectBag(b.n);bagGrid.appendChild(el)});
function selectBag(n){selected=n;const b=bags[n-1];document.querySelectorAll('.bag').forEach(x=>x.classList.toggle('active',+x.dataset.n===n));$('height').value=b.h;$('width').value=b.w;$('gusset').value=b.g;$('material').value=b.material;$('selectedPhoto').src=embeddedBagImages['bag-'+String(n).padStart(2,'0')+'.webp'];$('selectedPhoto').alt='Selected Bag '+n;$('selectedName').textContent='Bag '+n+ (b.cup?' · '+b.cup:'');$('selectedMaterial').textContent=b.material;update()}
let quantitySets=[],chosenQuantities=[],pendingQuantities=[],activeSet=0;
const formatQty=n=>n.toLocaleString('en-MY');
function parseQty(raw){const value=raw.trim();if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value))return NaN;const n=Number(value.replace(/,/g,''));return Number.isSafeInteger(n)&&n>=500?n:NaN}
function makeQuantitySets(q){
  if(q===2000)return [[1000,2000,3000,5000],[2000,5000,7500,10000],[2000,5000,10000,15000]];
  if(q===5000)return [[3000,5000,7500,10000],[5000,10000,15000,20000],[5000,10000,20000,30000]];
  const round=n=>Math.max(500,Math.ceil(n/500)*500);
  const unique=arr=>{const values=[...new Set(arr)].sort((a,b)=>a-b);while(values.length<4)values.push(round(values[values.length-1]+500));return values};
  return [unique([Math.max(500,Math.floor(q*.6/500)*500),q,round(q*1.5),round(q*2)]),unique([q,round(q*2),round(q*3),round(q*4)]),unique([q,round(q*2),round(q*4),round(q*6)])];
}
function quantity(){return chosenQuantities.length===4?chosenQuantities.map(formatQty).join(' / ')+' pcs':'Choose and confirm four quantities'}
function qtyError(message){$('quantityError').textContent=message}
function tierMarkup(values){return values.map(n=>'<span>'+formatQty(n)+'<small>pcs</small></span>').join('')}
function selectSet(n){activeSet=n;chosenQuantities=n===4?[]:[...quantitySets[n-1]];pendingQuantities=[];$('customQuantities').hidden=n!==4;$('quantityReview').hidden=true;qtyError('');$('quantityStatus').textContent=n===4?'': 'Selected: '+quantity();update()}
$('showOptions').onclick=()=>{
  const q=parseQty($('desiredQty').value);if(!Number.isFinite(q)){qtyError('Please enter a whole-number quantity of at least 500 pcs.');$('desiredQty').focus();return}
  quantitySets=makeQuantitySets(q);$('optionsIntro').textContent='Based on your requested '+formatQty(q)+' pcs, choose four quantities to compare.';
  $('suggestedSets').innerHTML=quantitySets.map((set,i)=>'<label class="set-card"><input type="radio" name="qtySet" value="'+(i+1)+'" '+(i===0?'checked':'')+'><span><strong>Set '+(i+1)+' — '+['Smaller quantities','Medium quantities','Larger quantities'][i]+'</strong><span class="tier-values">'+tierMarkup(set)+'</span></span></label>').join('');
  document.querySelector('input[name="qtySet"][value="4"]').checked=false;$('quantityOptions').hidden=false;selectSet(1);
};
$('quantityOptions').addEventListener('change',e=>{if(e.target.name==='qtySet')selectSet(Number(e.target.value))});
$('desiredQty').addEventListener('input',()=>{chosenQuantities=[];activeSet=0;$('quantityOptions').hidden=true;qtyError('');update()});
function resetCustom(){chosenQuantities=[];pendingQuantities=[];$('quantityReview').hidden=true;$('quantityStatus').textContent='';qtyError('');update()}
[1,2,3,4].forEach(i=>$('tier'+i).addEventListener('input',resetCustom));
$('reviewQuantities').onclick=()=>{
  const raw=[1,2,3,4].map(i=>$('tier'+i).value);if(raw.some(v=>!v.trim())){qtyError('Please enter all four quantities to continue.');return}
  const values=raw.map(parseQty);if(values.some(v=>!Number.isFinite(v))){qtyError('Each quantity must be a whole number of at least 500 pcs.');return}
  if(new Set(values).size!==4){qtyError('Please enter four different quantities so you can compare prices.');return}
  pendingQuantities=values.sort((a,b)=>a-b);pendingQuantities.forEach((n,i)=>$('tier'+(i+1)).value=formatQty(n));qtyError('');$('sortedQuantities').innerHTML=tierMarkup(pendingQuantities);$('quantityReview').hidden=false;$('confirmQuantities').focus();
};
$('editQuantities').onclick=()=>{resetCustom();$('tier1').focus()};
$('confirmQuantities').onclick=()=>{if(pendingQuantities.length!==4)return;chosenQuantities=[...pendingQuantities];$('quantityReview').hidden=true;$('quantityStatus').textContent='Confirmed: '+quantity();update()};
$('quoteForm').addEventListener('submit',e=>e.preventDefault());
$('desiredQty').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('showOptions').click()}});
function volumeState(h,w,g){
  const valid=[h,w,g].every(v=>Number.isFinite(v)&&v>0);
  const cubicMM=h*w*g;
  return {valid:valid&&Number.isFinite(cubicMM),volume:cubicMM/1e9,large:valid&&cubicMM>17000000};
}
function updateVolume(){
  const sizes=['height','width','gusset'].map(id=>Number($(id).value));
  const state=volumeState(...sizes);
  $('bagVolume').textContent=state.valid?state.volume.toFixed(5):'—';
  $('volumeFormula').textContent=state.valid?sizes.map(v=>String(v/1000)).join(' × ')+' = '+state.volume.toFixed(5)+' m³':'Enter three positive dimensions to calculate volume.';
  const white=selected<=8;
  [...$('material').options].forEach(o=>{if(o.dataset.heavy==='1')o.disabled=o.dataset.family!==(white?'white':'recycled')});
  const material=heavyMaterial(white);
  const applied=$('material').value===material;
  $('materialAdvice').hidden=!state.valid||!state.large||!material;
  $('materialAdviceText').textContent=applied?'140 gsm selected for this large bag. MPak will confirm carrying strength.':'This bag is larger than 0.017 m³. Please select '+material+'. MPak will confirm carrying strength.';
  $('applyMaterial').textContent='Select '+material;
  $('applyMaterial').hidden=applied;
  const isHeavy=($('material').selectedOptions[0]||{dataset:{}}).dataset.heavy==='1';
  $('strengthHelp').hidden=!state.large&&!isHeavy;
  $('selectedMaterial').textContent=$('material').value;
}
function update(){
  $('success').classList.remove('show');$('quoteBtn').disabled=!optionsLoaded;
  updateVolume();
  const card=document.querySelector('.bag.active');
  const values=['height','width','gusset'].map(id=>$(id).value || '—');
  if(card){
    const labels=card.querySelectorAll('.dimension-overlay text');
    labels.forEach((label,i)=>label.textContent=values[i]+(i===0?' mm':''));
    card.setAttribute('aria-label','Bag '+selected+', height '+values[0]+', width '+values[1]+', gusset '+values[2]+' millimetres, '+$('material').value);
  }
  reshapeBag();
  const rows=[['1','Bag & size','Bag '+selected+' · '+$('height').value+' × '+$('width').value+' × '+$('gusset').value+' mm (H × W × G)'],['2','Material',$('material').value],['3','Printing',$('print').value],['4','Handle',$('handle').value],['5','Quantities to quote',quantity()],['6','Delivery',deliverySummary()]];$('specs').innerHTML=rows.map(r=>'<div class="spec"><b>'+r[0]+'</b><span><em>'+r[1]+'</em>'+escapeHTML(r[2])+'</span></div>').join('')}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function deliverySummary(){const country=$('country').value==='MY'?'Malaysia':'Singapore';if($('laterDestination').checked)return country+' · destination to follow · delivery excluded';const place=$('country').value==='MY'?[$('areaName').value.trim(),$('stateName').value,$('postcode').value].filter(Boolean).join(', '):$('postcode').value;return country+' · '+(place||'destination pending')+' · delivery excluded'}
function deliveryValidation(){if($('laterDestination').checked)return '';const sg=$('country').value==='SG';if(!sg&&!$('areaName').value.trim())return 'Please enter your area / town, or choose to provide the location later.';if(!sg&&!$('stateName').value)return 'Please select your state / federal territory, or provide the location later.';const code=$('postcode').value;if((sg||code)&&!(sg?/^\d{6}$/:/^\d{5}$/).test(code))return sg?'Please enter a 6-digit Singapore postcode, or choose to provide it later.':'Please enter a 5-digit Malaysia postcode, or leave it blank.';return ''}
function refreshDelivery(){const sg=$('country').value==='SG',later=$('laterDestination').checked;$('myDestination').hidden=sg||later;$('postcodeEntry').hidden=later;$('singaporePrefix').hidden=!sg;$('postcode').maxLength=sg?6:5;$('postcode').placeholder=sg?'6-digit postcode':'5-digit postcode';$('postcodeLabel').textContent=sg?'Delivery postcode':'Postcode (optional)';$('postcodeHelp').textContent=sg?'Enter all 6 digits, including any leading zero. Full address can follow later.':'Add it if you know it. It helps MPak check delivery charges.';$('deliveryError').textContent='';update()}
function setCountry(){$('postcode').value='';$('areaName').value='';$('stateName').value='';$('deliveryStatus').textContent='';refreshDelivery()}
$('country').addEventListener('change',setCountry);
document.querySelectorAll('input,select').forEach(x=>x.addEventListener('input',update));
$('postcode').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,e.target.maxLength);$('deliveryError').textContent='';$('deliveryStatus').textContent='';update()});
['areaName','stateName'].forEach(id=>$(id).addEventListener('input',()=>{$('deliveryError').textContent='';$('deliveryStatus').textContent='';update()}));
$('laterDestination').addEventListener('change',refreshDelivery);
$('loadProfile').onclick=()=>{$('laterDestination').checked=false;const sg=$('country').value==='SG';$('areaName').value=sg?'':'Seri Kembangan';$('stateName').value=sg?'':'Selangor';$('postcode').value=sg?'238801':'43300';refreshDelivery();$('deliveryStatus').textContent='Sample saved destination loaded. Please check or edit it for this inquiry. No account connected.'};
$('quoteBtn').onclick=()=>{if(chosenQuantities.length!==4){qtyError(activeSet===4?'Please review and confirm your four quantities.':'Please enter your desired quantity and choose a quantity set.');$('quantitySection').scrollIntoView({behavior:'smooth',block:'center'});(activeSet===4?$('tier1'):$('desiredQty')).focus({preventScroll:true});return}const issue=deliveryValidation();if(issue){$('deliveryError').textContent=issue;$('postcodeField').scrollIntoView({behavior:'smooth',block:'center'});return}if(!(window.CustomerAuth&&window.CustomerAuth.isLoggedIn())){saveQuoteDraft();if(window.CustomerAuth){window.CustomerAuth.requireLogin('/html/quotation.html')}else{window.location.href='/customerlogin.html?returnTo='+encodeURIComponent('/html/quotation.html')}return}submitQuotation()};
$('applyMaterial').onclick=()=>{const m=heavyMaterial(selected<=8);if(m){$('material').value=m;update()}};
let detailsPinned=false;
function showVolumeDetails(show){$('volumePopup').hidden=!show;$('volumeDetails').setAttribute('aria-expanded',String(show));}
$('volumeDetails').onclick=()=>{detailsPinned=!detailsPinned;showVolumeDetails(detailsPinned)};
$('volumeHelp').addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')showVolumeDetails(true)});
$('volumeHelp').addEventListener('pointerleave',()=>{if(!detailsPinned)showVolumeDetails(false)});
$('volumeDetails').addEventListener('focus',()=>showVolumeDetails(true));
$('volumeDetails').addEventListener('blur',()=>{if(!detailsPinned)showVolumeDetails(false)});
document.addEventListener('click',e=>{if(!$('volumeHelp').contains(e.target)){detailsPinned=false;showVolumeDetails(false)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){detailsPinned=false;showVolumeDetails(false)}});
const DRAFT_KEY='mpakQuoteDraft';
function captureQuoteDraft(){
  return {
    selected,
    fields:{height:$('height').value,width:$('width').value,gusset:$('gusset').value,material:$('material').value,print:$('print').value,handle:$('handle').value,country:$('country').value,postcode:$('postcode').value,areaName:$('areaName').value,stateName:$('stateName').value,laterDestination:$('laterDestination').checked,desiredQty:$('desiredQty').value,tier1:$('tier1').value,tier2:$('tier2').value,tier3:$('tier3').value,tier4:$('tier4').value},
    quantitySets,chosenQuantities,activeSet,
    quantityOptionsVisible:!$('quantityOptions').hidden,
    optionsIntro:$('optionsIntro').textContent,
    quantityStatusText:$('quantityStatus').textContent
  };
}
function saveQuoteDraft(){try{sessionStorage.setItem(DRAFT_KEY,JSON.stringify(captureQuoteDraft()))}catch(e){}}
function restoreQuoteDraft(d){
  if(!d)return;
  selectBag(d.selected||1);
  Object.entries(d.fields||{}).forEach(([id,val])=>{const el=$(id);if(!el)return;if(el.type==='checkbox')el.checked=!!val;else el.value=val});
  quantitySets=d.quantitySets||[];chosenQuantities=d.chosenQuantities||[];activeSet=d.activeSet||0;
  if(quantitySets.length&&activeSet>=1&&activeSet<=3){
    $('suggestedSets').innerHTML=quantitySets.map((set,i)=>'<label class="set-card"><input type="radio" name="qtySet" value="'+(i+1)+'" '+(i+1===activeSet?'checked':'')+'><span><strong>Set '+(i+1)+' — '+['Smaller quantities','Medium quantities','Larger quantities'][i]+'</strong><span class="tier-values">'+tierMarkup(set)+'</span></span></label>').join('');
    $('optionsIntro').textContent=d.optionsIntro||'';$('quantityOptions').hidden=false;$('customQuantities').hidden=true;
  }else if(activeSet===4){
    $('customQuantities').hidden=false;$('quantityOptions').hidden=!d.quantityOptionsVisible;
  }
  $('quantityStatus').textContent=d.quantityStatusText||(chosenQuantities.length===4?'Confirmed: '+quantity():'');
  refreshDelivery();update();
  $('draftRestored').classList.add('show');
  $('draftRestored').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function loadQuoteDraftIfAny(){
  let raw=null;try{raw=sessionStorage.getItem(DRAFT_KEY)}catch(e){}
  if(!raw)return;
  try{sessionStorage.removeItem(DRAFT_KEY)}catch(e){}
  try{restoreQuoteDraft(JSON.parse(raw))}catch(e){}
}
initQuotation();

// ------------------------------------------------------------------
// Database-backed options (paper_master, printing_master, handle_master)
// <option value> stays the human label; data-id carries the database id.
// ------------------------------------------------------------------
const paperLabel=p=>p.paper_name+' '+p.gsm+' gsm';
function fillSelect(id,rows,toOption){
  $(id).innerHTML=rows.map(r=>{const o=toOption(r);return '<option value="'+escapeHTML(o.value)+'" data-id="'+o.id+'"'+(o.extra||'')+'>'+escapeHTML(o.text)+'</option>'}).join('');
}
function populateOptions(opts){
  fillSelect('material',opts.papers,p=>{
    const heavy=p.gsm>=140,family=/white/i.test(p.color)?'white':'recycled';
    return {value:paperLabel(p),id:p.paper_id,text:paperLabel(p)+(heavy?' — for items over 3 kg only':''),extra:' data-heavy="'+(heavy?1:0)+'" data-family="'+family+'"'};
  });
  fillSelect('print',opts.printing,r=>({value:r.printing_name,id:r.printing_id,text:r.printing_name}));
  fillSelect('handle',opts.handles,r=>({value:r.handle_name,id:r.handle_id,text:r.handle_name}));
}
// Heavier (140 gsm) paper in the same colour family as the selected bag.
function heavyMaterial(white){
  const o=[...$('material').options].find(o=>o.dataset.heavy==='1'&&o.dataset.family===(white?'white':'recycled'));
  return o?o.value:'';
}

// ------------------------------------------------------------------
// Customer session + submit
// ------------------------------------------------------------------
// ADJUST HERE if /scripts/auth.js exposes the logged-in customer differently.
// Must return {customer_id, email} or null.
function getCustomerSession(){
  const a=window.CustomerAuth;if(!a)return null;
  const c=(typeof a.getCustomer==='function'&&a.getCustomer())||(typeof a.getUser==='function'&&a.getUser())||a.customer||null;
  const id=c&&c.customer_id,email=c&&(c.customer_email||c.email);
  return id&&email?{customer_id:id,email}:null;
}
function goLogin(){
  saveQuoteDraft();
  if(window.CustomerAuth)window.CustomerAuth.requireLogin('/html/quotation.html');
  else window.location.href='/customerlogin.html?returnTo='+encodeURIComponent('/html/quotation.html');
}
const selectedId=id=>Number(($(id).selectedOptions[0]||{dataset:{}}).dataset.id);
function buildPayload(){
  const my=$('country').value==='MY';
  return {
    gallery_bag_no:selected,
    height_mm:Number($('height').value),width_mm:Number($('width').value),gusset_mm:Number($('gusset').value),
    paper_id:selectedId('material'),printing_id:selectedId('print'),handle_id:selectedId('handle'),
    quantities:chosenQuantities,
    delivery_country:$('country').value,
    delivery_area:my?$('areaName').value.trim():'',
    delivery_state:my?$('stateName').value:'',
    postcode:$('postcode').value,
    delivery_later:$('laterDestination').checked,
    quotation_purpose:document.querySelector('input[name="purpose"]:checked').value
  };
}
async function submitQuotation(){
  const session=getCustomerSession();
  if(!session){goLogin();return}
  const btn=$('quoteBtn');btn.disabled=true;$('apiError').textContent='';
  try{
    const r=await QuotationAPI.submit({...buildPayload(),...session});
    $('success').textContent='✓ Quotation '+r.quotation_no+' submitted. MPak will review your specification and send prices for all four quantities.';
    $('success').classList.add('show');$('success').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(e){
    if(e.status===401){goLogin();return}
    $('apiError').textContent=e.message;btn.disabled=false;
  }
}

async function initQuotation(){
  try{populateOptions(await QuotationAPI.loadOptions());optionsLoaded=true}
  catch(e){$('apiError').textContent='Could not load quotation options. Please refresh the page.'}
  selectBag(1);loadQuoteDraftIfAny();
}