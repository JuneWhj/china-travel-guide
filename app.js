const $=selector=>document.querySelector(selector);
const input=$('#searchInput'),grid=$('#guideGrid'),status=$('#status'),empty=$('#emptyState');
let searchAbort,articleAbort,currentId,lastQuery='',lastFocus;
let visibleItems=[],visibleCount=0;
function element(tag,text,className) {
  const node=document.createElement(tag);
  if(text!==undefined) node.textContent=text;
  if(className) node.className=className;
  return node;
}
function imageElement(src,alt,className) {
  if(!src) return null;
  const image=element('img',undefined,className);
  image.src=src;image.alt=alt||'';image.loading='lazy';image.referrerPolicy='no-referrer';
  image.addEventListener('error',()=>image.closest('figure, .guide-media')?.remove(),{once:true});
  return image;
}
function plainSnippet(html) {
  // Parse as inert HTML, but never insert source markup into the live document.
  return new DOMParser().parseFromString(html||'','text/html').body.textContent||'';
}
async function api(path,signal) {
  const response=await staticApi(path,signal);
  const value=await response.json();
  if(!response.ok) throw new Error(value.error||'加载失败，请重试');
  return value;
}
function setEmpty(message) {empty.textContent=message;empty.classList.add('show');}
function mapSearchUrl(name,city){
  const url=new URL('https://uri.amap.com/search');
  const place=String(name||'').replace(/（[^）]*）/g,'').replace(/\s*·\s*.*$/,'').trim();
  url.searchParams.set('keyword',[city,place].filter(Boolean).join(' '));
  if(city)url.searchParams.set('city',city);
  url.searchParams.set('view','map');url.searchParams.set('callnative','0');url.searchParams.set('src','china-travel-guide');
  return url.href;
}
function mapLink(name,city,label='在高德地图查看位置 ↗'){
  const link=element('a',label,'map-link');link.href=mapSearchUrl(name,city);
  link.target='_blank';link.rel='noopener noreferrer';return link;
}
const mobileMap=window.matchMedia('(max-width: 700px)').matches;
function renderCard(item){
  const card=element('article',undefined,'guide-card');
  if(item.image){const media=element('figure',undefined,'guide-media');media.append(imageElement(item.image,item.imageAlt||item.title));card.append(media);}
  card.append(element('span',(item.scope?item.scope+' · ':'')+(item.attractionType||item.category||'目的地')+' · '+(item.city||'中国')+' · '+(item.mapLabel?'带位置地图':'开放资料'),'guide-source'),element('h3',item.title),element('p',plainSnippet(item.recommendation||item.snippet)));
  const button=element('button','站内阅读 →','guide-link');
  button.addEventListener('click',()=>openArticle(item.id,item.title));
  card.append(button);grid.append(card);
}
function showMore(){
  const next=visibleItems.slice(visibleCount,visibleCount+12);
  next.forEach(renderCard);visibleCount+=next.length;
  const button=$('#moreResults');
  button.hidden=visibleCount>=visibleItems.length;
  if(!button.hidden)button.textContent='查看更多攻略（已显示 '+visibleCount+' / '+visibleItems.length+'）';
}
async function search(query,scroll=true) {
  const q=query.trim();
  if(!q||q.length>80) return;
  searchAbort?.abort(); articleAbort?.abort();
  const controller=new AbortController(); searchAbort=controller;
  lastQuery=q;input.value=q;$('#reader').hidden=true;$('#results').hidden=false;
  $('#retry').hidden=true;$('#moreResults').hidden=true;grid.replaceChildren();empty.classList.remove('show');
  $('#resultsTitle').textContent=q==='精选'?'全国目的地与景点':'“'+q+'”的相关景点';
  status.textContent='正在获取旅行资料…';grid.setAttribute('aria-busy','true');
  history.replaceState(null,'','?q='+encodeURIComponent(q));
  if(scroll)$('#results').scrollIntoView({behavior:'smooth',block:'start'});
  try {
    const data=await api('/api/search?q='+encodeURIComponent(q),controller.signal);
    if(controller.signal.aborted) return;
    const attractionCount=data.items.filter(item=>item.category==='景点').length;
    if(data.kind==='place')$('#resultsTitle').textContent=data.place+' · 值得考虑的景点';
    status.textContent=data.kind==='place'?'找到 '+attractionCount+' 处景点'+(data.items.length>attractionCount?' · 附地区总攻略':''):'找到 '+data.items.length+' 篇攻略';
    if(data.notice) status.textContent+=' · '+data.notice;
    if(!data.items.length) setEmpty('暂未找到相关资料。试试更简短的地名，例如“大理”或“北京”。');
    visibleItems=data.items;visibleCount=0;showMore();
  } catch(error) {
    if(controller.signal.aborted) return;
    status.textContent='获取失败';setEmpty(error.message);$('#retry').hidden=false;
  } finally {if(!controller.signal.aborted)grid.removeAttribute('aria-busy');}
}
async function openArticle(id,title) {
  articleAbort?.abort();
  const controller=new AbortController();articleAbort=controller;currentId=id;lastFocus=document.activeElement;
  const reader=$('#reader');reader.hidden=false;$('#results').hidden=true;
  $('#articleTitle').textContent=title;$('#articleBody').replaceChildren();$('#attribution').replaceChildren();
  $('#retryArticle').hidden=true;$('#articleStatus').textContent='正在加载正文…';
  reader.scrollIntoView({behavior:'smooth'});$('#articleTitle').focus({preventScroll:true});
  try {
    const data=await api('/api/article?id='+id,controller.signal);
    if(controller.signal.aborted)return;
    $('#articleTitle').textContent=data.title;
    $('#articleStatus').textContent=data.local?(data.category||'景点')+' · '+(data.city||'中国')+' · 图文攻略与位置地图':data.updated?'来源最近编辑：'+new Date(data.updated).toLocaleDateString('zh-CN'):'维基导游旅行资料';
    const fragment=document.createDocumentFragment();
    if(data.image){const figure=element('figure',undefined,'article-figure');figure.append(imageElement(data.image,data.imageAlt||data.title,'article-image'));if(data.imageSource){const caption=element('figcaption',data.imageSource);if(data.imageSourceUrl){const link=element('a','查看图片来源');link.href=data.imageSourceUrl;link.target='_blank';link.rel='noopener noreferrer';caption.append(document.createTextNode(' · '),link);}figure.append(caption);}fragment.append(figure);}
    for(const line of data.text.split(/\n+/).filter(x=>x.trim())) {
      const heading=line.match(/^={2,6}\s*(.*?)\s*={2,6}$/);
      fragment.append(element(heading?'h3':'p',heading?heading[1]:line));
    }
    if(Number.isFinite(data.lat)&&Number.isFinite(data.lon)) {
      const section=element('section',undefined,'location-section');
      section.append(element('h3','位置地图'));
      section.append(element('p',data.mapLabel||data.title,'location-label'));
      if(mobileMap){
        section.append(element('p','可直接在高德地图查看；需要站内预览时再展开地图，避免打开文章就加载地图拖慢手机。','mobile-map-help'));
        const preview=element('details',undefined,'mobile-map-preview');preview.append(element('summary','在站内展开地图'));
        const map=element('iframe',undefined,'location-map');map.title=(data.mapLabel||data.title)+'手机位置地图';map.loading='lazy';
        preview.addEventListener('toggle',()=>{if(preview.open&&!map.hasAttribute('src'))map.src=mapSearchUrl(data.mapLabel||data.title,data.city);});
        preview.append(map);section.append(preview);
      }
      else {
        const delta=.012,bbox=[data.lon-delta,data.lat-delta,data.lon+delta,data.lat+delta].join(',');
        const map=element('iframe',undefined,'location-map');
        map.title=(data.mapLabel||data.title)+'位置地图';
        map.src='https://www.openstreetmap.org/export/embed.html?bbox='+encodeURIComponent(bbox)+'&layer=mapnik&marker='+encodeURIComponent(data.lat+','+data.lon);
        map.loading='lazy';map.referrerPolicy='no-referrer';section.append(map);
      }
      section.append(mapLink(data.mapLabel||data.title,data.city,mobileMap?'手机打开高德地图看位置 ↗':'在高德地图查看位置 ↗'));
      const backup=element('a','备用地图 · OpenStreetMap ↗','map-backup');
      backup.href='https://www.openstreetmap.org/?mlat='+encodeURIComponent(data.lat)+'&mlon='+encodeURIComponent(data.lon)+'#map=14/'+data.lat+'/'+data.lon;
      backup.target='_blank';backup.rel='noopener noreferrer';section.append(backup);
      section.append(element('p',data.category==='美食'?'地图标注觅食区域，不代表指定餐厅；具体商家请以现场信息为准。':'位置仅供规划参考，请以景区当天入口与现场指引为准。','map-note'));
      fragment.append(section);
    }
    if(data.local&&Array.isArray(window.TRAVEL_FOODS)){
      const related=window.TRAVEL_FOODS.filter(food=>food.province===data.province);
      related.sort((a,b)=>Number(b.city===data.city)-Number(a.city===data.city));
      const selected=[],names=new Set();
      for(const food of related){const dish=food.aliases?.[0]||food.title;if(names.has(dish))continue;names.add(dish);selected.push(food);if(selected.length===2)break;}
      if(selected.length){
        const section=element('section',undefined,'food-section');
        section.append(element('h3','本地与同省延伸美食'));
        section.append(element('p','优先展示同城小吃；跨城美食会标明所在城市，不当作景点附近餐食。按地方特色、寻找便利、价格透明和饮食适配推荐，不展示未经核验的好评数，也不指定“必吃店”。','food-intro'));
        const cards=element('div',undefined,'food-grid');
        for(const food of selected){
          const card=element('article',undefined,'food-card');
          const figure=element('figure',undefined,'food-photo');
          if(food.image)figure.append(imageElement(food.image,food.imageAlt||food.title));
          if(food.imageSourceUrl){const cap=element('figcaption');const source=element('a','真实菜品照片 · 查看来源');source.href=food.imageSourceUrl;source.target='_blank';source.rel='noopener noreferrer';cap.append(source);figure.append(cap);}
          card.append(figure,element('h4',food.title),element('p',food.snippet||''));
          card.append(element('p',(food.city===data.city?'同城觅食区域：':'同省跨城 · '+food.city+'觅食区域：')+(food.mapLabel||food.city)+'。地图仅供寻找小吃，不代表推荐某家店。','food-place'));
          if(Number.isFinite(food.lat)&&Number.isFinite(food.lon)){
            if(!mobileMap){
              const d=.006,bbox=[food.lon-d,food.lat-d,food.lon+d,food.lat+d].join(',');
              const map=element('iframe',undefined,'food-map');map.title=(food.mapLabel||food.title)+'觅食位置地图';
              map.src='https://www.openstreetmap.org/export/embed.html?bbox='+encodeURIComponent(bbox)+'&layer=mapnik&marker='+encodeURIComponent(food.lat+','+food.lon);
              map.loading='lazy';map.referrerPolicy='no-referrer';card.append(map);
            }
            card.append(mapLink(food.mapLabel||food.title,food.city,'查看觅食区域地图 ↗'));
          }
          cards.append(card);
        }
        section.append(cards);fragment.append(section);
      }
    }
    if(data.local&&Array.isArray(window.TRAVEL_RESTAURANTS)){
      const shops=window.TRAVEL_RESTAURANTS.filter(shop=>shop.city===data.city);
      if(shops.length){
        const section=element('section',undefined,'restaurant-section');
        section.append(element('h3','同城店铺候选 · '+shops.length+' 家'));
        const budgetCounts=new Map();for(const shop of shops)budgetCounts.set(shop.budget,(budgetCounts.get(shop.budget)||0)+1);
        section.append(element('p','比较维度：地方特色、资料来源、价格档、路线便利、口味适配与排队成本。价格档分布：'+[...budgetCounts].map(([level,count])=>level+' × '+count).join(' · ')+'。资料查阅于 2026 年 9 月，不是实时评分榜；营业、地址和菜单请出发前再次核对。','restaurant-summary'));
        const cards=element('div',undefined,'restaurant-grid');
        for(const shop of shops){
          const card=element('article',undefined,'restaurant-card');
          card.append(element('span',shop.dish+' · '+shop.budget,'restaurant-tag'),element('h4',shop.name));
          card.append(element('p','适合：'+shop.fit,'restaurant-fit'));
          card.append(element('p','推荐依据：'+shop.reason));
          card.append(element('p','找店区域：'+shop.area,'restaurant-area'));
          card.append(element('p','到访前留意：'+shop.caution,'restaurant-caution'));
          const actions=element('div',undefined,'restaurant-actions');
          actions.append(mapLink(shop.name,shop.city,'地图找店 ↗'));
          const source=element('a','查看资料来源 ↗','restaurant-source');source.href=shop.url;source.target='_blank';source.rel='noopener noreferrer';actions.append(source);
          card.append(actions,element('small',shop.source));cards.append(card);
        }
        section.append(cards);fragment.append(section);
      }
    }
    $('#articleBody').append(fragment);
    const attributionText=data.local?'来源：行迹景点卡片。内容用于路线规划，未核实实时价格、开放时间或预约要求。':'来源：维基导游贡献者。本站保留文字、调整段落排版，未核实条目中的实时价格或营业信息。';
    $('#attribution').append(element('p',attributionText));
    if(data.url){
      const source=element('a','查看来源与作者记录');
      const sourceURL=new URL(data.url);
      if(sourceURL.origin==='https://zh.wikivoyage.org')source.href=sourceURL.href;
      source.target='_blank';source.rel='noopener noreferrer';
      $('#attribution').append(source,document.createTextNode(' · '));
    }
    const license=element('a',data.local?'规划提示':'CC BY-SA 4.0');
    license.href=data.local?'#':'https://creativecommons.org/licenses/by-sa/4.0/';license.target=data.local?'':'_blank';license.rel=data.local?'':'noopener noreferrer';
    $('#attribution').append(license);
  } catch(error) {
    if(controller.signal.aborted)return;
    $('#articleStatus').textContent=error.message;$('#retryArticle').hidden=false;
  }
}
$('#searchForm').addEventListener('submit',event=>{event.preventDefault();search(input.value);});
document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>search(button.dataset.query)));
$('#moreResults').addEventListener('click',showMore);
if(Array.isArray(window.TRAVEL_GUIDES)){
  const guides=window.TRAVEL_GUIDES;
  const regions=[...new Set(guides.filter(item=>item.id.startsWith('local-region-')).map(item=>item.province))];
  const foods=window.TRAVEL_FOODS||[];
  const restaurants=window.TRAVEL_RESTAURANTS||[];
  const attractionCount=guides.filter(item=>item.category==='景点').length;
  $('#catalogStats').textContent='覆盖 '+regions.length+' 个地区 · '+attractionCount+' 篇景点攻略 · '+foods.length+' 种小吃随文推荐';
  $('#foodStats').textContent='已整理 '+foods.length+' 种小吃的真实菜品图片与觅食区域；北京、成都、西安、长白山的景点攻略另附 '+restaurants.length+' 家有资料来源的店铺候选。';
  const select=$('#regionSelect');
  regions.forEach(region=>{const option=element('option',region);option.value=region;select.append(option);});
  select.addEventListener('change',()=>{if(select.value)search(select.value);});
}
$('#retry').addEventListener('click',()=>search(lastQuery));
$('#retryArticle').addEventListener('click',()=>openArticle(currentId,$('#articleTitle').textContent));
function backToResults(){articleAbort?.abort();$('#reader').hidden=true;$('#results').hidden=false;$('#results').scrollIntoView({behavior:'smooth',block:'start'});lastFocus?.focus({preventScroll:true});}
$('#back').addEventListener('click',backToResults);
$('#backBottom').addEventListener('click',backToResults);
const initial=new URLSearchParams(location.search).get('q');
search(initial||'精选',Boolean(initial));

