// ==UserScript==
// @name         Dev More Canvas Tools
// @description  Next generation canvas tools for simplifying your life
// @author       Nathan Wood
// @match        *://*.instructure.com/*
// @namespace    udcis.canvas
// @run-at       document-start
// @grant        none
// ==/UserScript==

f(function() {
    const path = window.location.pathname;
    if (path.startsWith("/profile") || path.startsWith("/about")) {
        const message = document.createElement('div');
        message.textContent = "Hello from my script!";
        message.style.position = "fixed";
        message.style.top = "20px";
        message.style.right = "20px";
        message.style.background = "yellow";
        message.style.padding = "10px";
        document.body.appendChild(message);
    }
})();