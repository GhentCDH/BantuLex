import './style.css';
import { createApp, defineAsyncComponent, defineComponent, h, markRaw } from 'vue';
import { createRouter, createWebHistory, useRoute, type RouteRecordRaw } from 'vue-router';
import axios from 'axios';
import { CroutonPlugin, CroutonRouter } from '@ghentcdh/crouton-vue';
import App from './App.vue';
import CoordinateList from './maps/CoordinateList.vue';
import CoordinateDetail from './maps/CoordinateDetail.vue';
import mapConfig from './maps/config.json';
import BulkImport from './bulk/BulkImport.vue';
// Custom pages under /admin/crouton/<id>: Crouton has no extension point for them, so the
// sidebar entry is added to its layout response and the route wrapper renders the page.
const BULK_ID = 'bulk-import';
const resourceRoute = CroutonRouter.flatMap((route): RouteRecordRaw[] => ('children' in route && route.children) || []).find(route => route.name === 'crouton/form')!;
const NativeResourceView = defineAsyncComponent(resourceRoute.component as () => Promise<any>);
resourceRoute.component = defineComponent({ setup() { const route = useRoute(); return () => route.params.formId === BULK_ID ? h(BulkImport) : h('div', [h(NativeResourceView), route.params.formId === mapConfig.resource ? h(CoordinateList) : null]); } }) as any;
const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes: [{ path: '/', children: [...CroutonRouter] }] });
const api = axios.create({ baseURL: '/api' });
api.interceptors.response.use((response) => {
  if (/\/_app\/layout(\?|$)/.test(response.config.url ?? '')) {
    const lexical = response.data?.sidebar?.find((item: any) => item.id === 'lexical');
    if (lexical?.children && !lexical.children.some((c: any) => c.id === BULK_ID)) lexical.children.push({ id: BULK_ID, label: 'Bulk import' });
  }
  return response;
});
createApp(App).use(CroutonPlugin(api, { readonlyRenderers: [{ tester: (ui) => ui.options?.format === 'coordinate-map' ? 30 : -1, renderer: markRaw(CoordinateDetail) }] })).use(router).mount('#app');
