const CACHE_NAME = 'todo-cache-v1';
const urlsToCache = [
    "/",
    "/index.html",
    "/styles.css",
    "/main.js",
    "/icons/icon-192x192.png",
    "/icons/icon-512x512.png"
];

self.addEventListener('install',(event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(urlsToCache);
        })
    );

});
self.addEventListener("activate",(event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) =>{
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if(cacheName !== CACHE_NAME){
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});