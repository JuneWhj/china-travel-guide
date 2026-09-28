const normalize=value=>String(value||'').toLowerCase().replace(/[\s·•—–-]/g,'');
const guideById=new Map(window.TRAVEL_GUIDES.map(item=>[item.id,item]));
const reply=(value,status=200)=>Response.json(value,{status});
const regions=window.TRAVEL_GUIDES.filter(item=>item.id.startsWith('local-region-'));
const asSearchItem=item=>({id:item.id,title:item.title,snippet:item.snippet,sourceLabel:item.source,local:true,image:item.image,imageAlt:item.imageAlt,imageSource:item.imageSource,imageSourceUrl:item.imageSourceUrl,category:item.category,attractionType:item.attractionType,recommendation:item.recommendation,city:item.city,province:item.province,mapLabel:item.mapLabel});
function shuffled(items){
  const list=[...items];
  for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}
  return list;
}
function featuredGuides(){
  const groups=new Map();
  for(const item of window.TRAVEL_GUIDES.filter(item=>item.category==='景点')){
    if(!groups.has(item.province))groups.set(item.province,[]);
    groups.get(item.province).push(item);
  }
  const leads=shuffled([...groups.values()]).map(group=>shuffled(group)[0]);
  const selected=new Set(leads.map(item=>item.id));
  return [...leads,...shuffled(window.TRAVEL_GUIDES.filter(item=>!selected.has(item.id)))];
}
function localSearch(q){
  const key=normalize(q);
  const placeKey=key.replace(/(旅游攻略|好玩的地方|旅游|攻略|景点)$/,'').replace(/(特别行政区|自治区|省|市)$/,'');
  if(key==='精选'||key==='热门')return {items:featuredGuides(),kind:'featured'};
  if(key==='目的地')return {items:regions,kind:'category'};
  if(key==='景点')return {items:window.TRAVEL_GUIDES.filter(item=>item.category==='景点'),kind:'category'};
  if(['自然风光','古迹人文','城市漫游','亲子体验'].includes(q))return {items:window.TRAVEL_GUIDES.filter(item=>item.attractionType===q),kind:'type'};
  if(key==='美食'||key==='小吃')return {items:regions,kind:'food',notice:'美食照片、推荐理由与觅食位置已放进各地景点攻略。'};
  const province=regions.find(item=>normalize(item.province)===placeKey)?.province;
  if(province){
    const items=window.TRAVEL_GUIDES.filter(item=>item.province===province&&(item.category==='景点'||item.id.startsWith('local-region-')));
    return {items,kind:'place',place:province};
  }
  const city=window.TRAVEL_GUIDES.find(item=>normalize(item.city)===placeKey)?.city;
  if(city){
    const own=window.TRAVEL_GUIDES.filter(item=>item.city===city&&(item.category==='景点'||item.id.startsWith('local-region-')));
    const homeProvince=own[0]?.province;
    const extension=window.TRAVEL_GUIDES.filter(item=>item.province===homeProvince&&item.city!==city&&(item.category==='景点'||item.id.startsWith('local-region-')));
    return {items:[...own,...extension],kind:'place',place:city,localCity:city,notice:extension.length?'先显示市内景点；标注“同省延伸”的景点可能相距较远，请另算跨城交通。':''};
  }
  const food=(window.TRAVEL_FOODS||[]).find(item=>normalize(item.title).includes(key)||item.aliases?.some(alias=>normalize(alias)===key));
  if(food){
    const items=window.TRAVEL_GUIDES.filter(item=>item.category==='景点'&&(item.city===food.city||item.province===food.province));
    return {items,kind:'food',place:food.city,notice:'这道小吃的照片和觅食位置在相关景点攻略内。'};
  }
  const items=window.TRAVEL_GUIDES.filter(item=>[item.title,...(item.aliases||[]),item.city,item.province,item.category,item.attractionType].some(alias=>{const value=normalize(alias);return value&&(value.includes(key)||key.includes(value));}));
  items.sort((a,b)=>Number(normalize(b.title).includes(key))-Number(normalize(a.title).includes(key)));
  return {items,kind:'query'};
}
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
    const local=localSearch(q);
    if(local.items.length)return reply({...local,items:local.items.map(item=>({...asSearchItem(item),scope:local.localCity&&item.city!==local.localCity?'同省延伸':null})),live:false});
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

