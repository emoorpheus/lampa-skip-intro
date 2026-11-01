
    // ---------- Хук для тестов: window.__SKIP_INTRO_TEST__ = {} до загрузки плагина ----------
    if (window.__SKIP_INTRO_TEST__ && typeof window.__SKIP_INTRO_TEST__ === 'object') {
        var T = window.__SKIP_INTRO_TEST__;
        T.core = AniskipCore;
        T.Logic = Logic;
        T.Settings = Settings;
        T.Store = Store;
        T.Health = Health;
        T.Series = Series;
        T.UserMarks = UserMarks;
        T.Smart = Smart;
        T.Stats = Stats;
        T.Sync = Sync;
        T.Net = Net;
        T.Torr = Torr;
        T.sharedFfp = sharedFfp;
        T.Sources = Sources;
        T.Anime = Anime;
        T.Loader = Loader;
        T.Subs = Subs;
        T.AudioDet = AudioDet;
        T.Button = Button;
        T.Warn = Warn;
        T.Marks = Marks;
        T.Hdr = Hdr;
        T.Keys = Keys;
        T.Menu = Menu;
        T.Diag = Diag;
        T.Controller = Controller;
        T.renamePluginEntry = renamePluginEntry;
        T.goNext = goNext;
        T.boot = boot;
    }

    function boot() {
        if (window.Lampa && Lampa.SettingsApi && Lampa.Player && Lampa.Player.listener && Lampa.Storage) Controller.init();
        else setTimeout(boot, 500);
    }

    function follow() {
        Lampa.Listener.follow('app', function (e) {
            if (e && e.type === 'ready') boot();
        });
        if (window.appready) boot();
        else setTimeout(boot, 1000);
    }

    if (window.Lampa && Lampa.Listener) {
        follow();
    } else {
        var waitLampa = setInterval(function () {
            if (window.Lampa && Lampa.Listener) {
                clearInterval(waitLampa);
                follow();
            }
        }, 300);
    }
})();
