import './style.css';
import { createApp, defineAsyncComponent, defineComponent, h, markRaw } from 'vue';
import { createRouter, createWebHistory, useRoute, type RouteRecordRaw } from 'vue-router';
import axios from 'axios';
import { CroutonPlugin, CroutonRouter } from '@ghentcdh/crouton-vue';
import { ModalService } from '@ghentcdh/ui';
import App from './App.vue';
import CoordinateList from './maps/CoordinateList.vue';
import CoordinateDetail from './maps/CoordinateDetail.vue';
import mapConfig from './maps/config.json';
import BulkImport from './bulk/BulkImport.vue';
import BulkEdit from './bulk/BulkEdit.vue';
import RelationLink from './relations/RelationLink.vue';
import RelatedTable from './relations/RelatedTable.vue';
// Custom pages under /admin/crouton/<id>: Crouton has no extension point for them, so the
// sidebar entry is added to its layout response and the route wrapper renders the page.
// Relation links lead to another resource's record. Crouton reads ?id=&event= only when its resource view mounts,
// and its modals are global, so the view is keyed by resource and the open modals are closed on such navigation.
const PAGES: Record<string, { label: string; component: any }> = {
  'bulk-import': { label: 'Bulk import', component: BulkImport },
  'bulk-edit': { label: 'Bulk edit', component: BulkEdit },
};
const resourceRoute = CroutonRouter.flatMap((route): RouteRecordRaw[] => ('children' in route && route.children) || []).find(route => route.name === 'crouton/form')!;
const NativeResourceView = defineAsyncComponent(resourceRoute.component as () => Promise<any>);
resourceRoute.component = defineComponent({ setup() { const route = useRoute(); return () => PAGES[route.params.formId as string] ? h(PAGES[route.params.formId as string].component) : h('div', [h(NativeResourceView, { key: route.params.formId as string }), route.params.formId === mapConfig.resource ? h(CoordinateList) : null]); } }) as any;
const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes: [{ path: '/', children: [...CroutonRouter] }] });
// getInstance() first: closeAll() fails before the first modal has created the service.
router.beforeEach((to, from) => { if (to.params.formId !== from.params.formId) { ModalService.getInstance(); ModalService.closeAll(); } });
const api = axios.create({ baseURL: '/api' });
api.interceptors.response.use((response) => {
  if (/\/_app\/layout(\?|$)/.test(response.config.url ?? '')) {
    const lexical = response.data?.sidebar?.find((item: any) => item.id === 'lexical');
    for (const [id, page] of Object.entries(PAGES)) if (lexical?.children && !lexical.children.some((c: any) => c.id === id)) lexical.children.push({ id, label: page.label });
  }
  return response;
});
// Read-only renderers for the detail view, selected by a calculated column's options.format.
const readonlyFormats: Record<string, any> = { 'coordinate-map': CoordinateDetail, 'relation-link': RelationLink, 'related-table': RelatedTable };
const readonlyRenderers = Object.entries(readonlyFormats).map(([format, renderer]) => ({ tester: (ui: any) => ui.options?.format === format ? 30 : -1, renderer: markRaw(renderer) }));
createApp(App).use(CroutonPlugin(api, { readonlyRenderers })).use(router).mount('#app');
