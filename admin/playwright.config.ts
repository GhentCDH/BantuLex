import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',workers:1,timeout:30000,use:{headless:true,baseURL:'http://127.0.0.1:14445/admin/',trace:'retain-on-failure'},reporter:'list'});
