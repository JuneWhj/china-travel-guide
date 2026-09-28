const normalize=value=>String(value||'').toLowerCase().replace(/[\s·•—–-]/g,'');
const guideById=new Map(window.TRAVEL_GUIDES.map(item=>[item.id,item]));
const reply=(value,status=200)=>Response.json(value,{status});
async function wiki(params,signal){
  const url=new URL('https://zh.wikivoyage.org/w/api.php');
  for(const [key,value] of Object.entries({action:'query',format:'json',formatversion:'2',variant:'zh-cn',origin:'*',...params}))url.searchParams.set(key,value);
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error('在线资料暂时不可用');
  const value=await response.json();
  if(value.error)throw new Error('在线资料暂时不可用');
  return value;
}
async function staticApi(path,signal){
  const request=new URL(path,location.href);
  if(request.pathname.endsWith('/api/search')){
    const q=(request.searchParams.get('q')||'').trim();
    if(!q||q.length>80)return reply({error:'请输入 1–80 字的目的地名称'},400);
    const key=normalize(q);
    const local=(key==='精选'||key==='热门'?window.TRAVEL_GUIDES:window.TRAVEL_GUIDES.filter(item=>[item.title,...item.aliases,item.city,item.category].some(alias=>normalize(alias).includes(key)||key.includes(normalize(alias)))))
      .map(item=>({id:item.id,title:item.title,snippet:item.snippet,sourceLabel:item.source,local:true,image:item.image,imageAlt:item.imageAlt,imageSource:item.imageSource,imageSourceUrl:item.imageSourceUrl,category:item.category,city:item.city,mapLabel:item.mapLabel}));
    if(local.length)return reply({items:local,live:false,notice:'已优先展示站内精选。'});
    try{
      const result=await wiki({list:'search',srsearch:q,srnamespace:'0',srlimit:'12',srprop:'snippet'},signal);
      const found=result.query?.search||[];
      let pages=[];
      if(found.length){
        const details=await wiki({pageids:found.map(item=>item.pageid).join('|'),prop:'pageimages|coordinates',piprop:'thumbnail',pithumbsize:'1200',colimit:'1'},signal);
        pages=details.query?.pages||[];
      }
      const byId=new Map(pages.map(page=>[page.pageid,page]));
      const items=found.filter(item=>byId.get(item.pageid)?.thumbnail?.source&&byId.get(item.pageid)?.coordinates?.[0])
        .map(item=>({id:item.pageid,title:item.title,snippet:item.snippet,sourceLabel:'维基导游 · 开放资料',image:byId.get(item.pageid).thumbnail.source,imageAlt:item.title,category:'目的地',city:item.title,mapLabel:item.title}));
      return reply({items,live:true});
    }catch(error){if(signal?.aborted)throw error;return reply({items:[],live:false,notice:'在线资料暂时不可用，请试试其他地名。'});}
  }
  if(request.pathname.endsWith('/api/article')){
    const id=request.searchParams.get('id')||'';
    if(!/^(?:local-[a-z0-9-]+|[1-9][0-9]{0,9})$/.test(id))return reply({error:'无效的资料编号'},400);
    const local=guideById.get(id);
    if(local)return reply({...local,local:true,url:null,updated:null});
    try{
      const result=await wiki({pageids:id,prop:'extracts|info|revisions|pageimages|coordinates',explaintext:'1',inprop:'url',rvprop:'timestamp',rvlimit:'1',piprop:'thumbnail',pithumbsize:'1200',colimit:'1'},signal);
      const page=result.query?.pages?.[0];
      if(!page||page.missing)return reply({error:'该资料已不存在，请重新搜索'},404);
      if(!page.extract?.trim())return reply({error:'该条目暂无可读取正文'},422);
      return reply({id:page.pageid,title:page.title,text:page.extract,url:page.fullurl||'https://zh.wikivoyage.org/?curid='+page.pageid,updated:page.revisions?.[0]?.timestamp||null,local:false,image:page.thumbnail?.source,imageAlt:page.title,imageSource:'维基导游页面图片',imageSourceUrl:page.fullurl,lat:page.coordinates?.[0]?.lat,lon:page.coordinates?.[0]?.lon,mapLabel:page.title});
    }catch(error){if(signal?.aborted)throw error;return reply({error:'在线资料暂时无法读取，请稍后重试'},502);}
  }
  return reply({error:'页面不存在'},404);
}

