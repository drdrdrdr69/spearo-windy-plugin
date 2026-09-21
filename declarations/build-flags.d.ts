/**
 * Компайл-тайм флаги, которые подставляет rollup (swc globals, см. rollup.config.js).
 * true только в dev-сборке (`npm start`); в опубликованном бандле — false.
 */
declare const __SPEARO_DEV_BUILD__: boolean;
