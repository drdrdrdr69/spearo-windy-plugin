import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-spearo',
    version: '0.1.4',
    icon: '🤿',
    title: 'spearo — water visibility & no-take zones',
    description:
        'Water visibility forecast for spearfishing and freediving, wave/wind safety verdict and no-take zone polygons. Data by spearo.app.',
    author: 'spearo.app',
    repository: 'https://github.com/drdrdrdr69/spearo-windy-plugin',
    homepage: 'https://spearo.app',

    // Правая панель на десктопе — влезают карточки на два дня.
    desktopUI: 'rhpane',
    // Мобильный UI: 'fullscreen' — лист, который пользователь стягивает в половинное
    // положение и видит карту под ним (docs.windy-plugins.com → plugin-layouts).
    // 'small' — крошечная полоса снизу без гарантий прокрутки: семь дней, метрики и
    // тумблер зон туда не помещаются.
    mobileUI: 'fullscreen',

    // Пункт в контекстном меню карты (ПКМ / долгий тап) → плагин открывается с lat/lon.
    // Подпись пункта Windy берёт из `title` — отдельного лейбла API не даёт.
    addToContextmenu: true,
    // Пока панель открыта — клики по карте переносят точку.
    listenToSingleclick: true,

    // https://www.windy.com/plugin/spearo/38.44/-9.10
    routerPath: '/spearo/:lat?/:lon?',

    // Публичный релиз: плагин виден в галерее после ревью Windy.
    private: false,
};

export default config;
