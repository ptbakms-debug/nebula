(function(){
  var C=window.NEBULA_CONFIG||{};
  var map={operator:C.OPERATOR_NAME,email:C.CONTACT_EMAIL,region:C.SUPABASE_REGION};
  var missing=[];
  document.querySelectorAll('[data-fill]').forEach(function(el){
    var k=el.getAttribute('data-fill'), v=map[k];
    if(v){ el.textContent=v; if(k==='email'&&el.tagName==='A') el.href='mailto:'+v; }
    else { el.textContent='[ISI '+k.toUpperCase()+' DI config.js]'; el.className='todo'; missing.push(k); }
  });
  if(missing.length){ var b=document.getElementById('todo'); if(b) b.hidden=false; }
})();
