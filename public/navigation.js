// Framework7 owns the page stack and the interactive edge-swipe animation.
// Installed PWAs use the internal stack; browser tabs also integrate browser Back.
export function createNavigation({onNotebook,onHome,onChange}) {
  const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
  const app=new Framework7({
    el:'#app',name:'Notas',theme:'ios',darkMode:true,
    touch:{tapHold:false},
    routes:[{path:'/',content:document.querySelector('.page[data-name="home"]').outerHTML,on:{pageInit(){onHome()}}}, {
      path:'/note/:kind/',
      content:document.querySelector('#notebook-template').innerHTML,
      on:{pageInit(event,page){onNotebook(page.route.params.kind)}}
    }],
  });
  const main=app.views.create('.view-main',{
    url:'/',iosSwipeBack:true,iosSwipeBackActiveArea:30,
    preloadPreviousPage:true,restoreScrollTopOnBack:true,
    browserHistory:!standalone,browserHistoryOnLoad:false,
    browserHistoryStoreHistory:false,
    on:{
      // F7 9.2 swipe-back updates currentPage but leaves currentPageEl stale.
      // Keep its router pointer aligned before another navigation or editor save.
      swipebackBeforeChange({previousPageEl}){app.views.main.router.currentPageEl=previousPageEl},
      pageAfterIn(page){
      document.body.dataset.screen=page.name;
      if(page.name==='home')onHome();
      onChange?.(page);
    }},
  });
  // Dialogs capture gestures themselves and must not slide the page underneath.
  const dialog=document.querySelector('#sheet');
  new MutationObserver(()=>{main.params.iosSwipeBack=!dialog.open}).observe(dialog,{attributes:true,attributeFilter:['open']});
  document.body.dataset.screen='home';
  return {
    openNote(kind){
      if(main.el.querySelector('.page-current')?.dataset.name==='editor'){
        main.once('pageAfterIn',()=>{main.router.updateCurrentUrl(`/note/${kind}/`);onNotebook(kind)});
        main.router.back();return;
      }
      if(main.el.querySelector('.page-current')?.dataset.name==='notebook'){main.router.updateCurrentUrl(`/note/${kind}/`);onNotebook(kind);return}
      main.router.navigate(`/note/${kind}/`);
    },
    editor(html,ready){
      const url=`/editor/${crypto.randomUUID()}/`;
      const route={path:url,content:`<div class="page" data-name="editor"><div class="page-content"><div class="editor-page"><button class="back-note" data-back aria-label="Voltar à nota">‹ Voltar</button><div class="editor-body">${html}</div></div></div></div>`,on:{pageInit(){ready()}}};
      main.router.routes.push(route);
      main.router.navigate(url);
    },
    back(){if(main.router.history.length>1)main.router.back()},
    get isEditor(){return main.el.querySelector('.page-current')?.dataset.name==='editor'},
  };
}
