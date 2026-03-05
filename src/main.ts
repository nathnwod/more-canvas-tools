import { compose } from "@typed/compose";
import { environment, errors, log, userscripter } from "userscripter";

import * as CONFIG from "~src/config";
import OPERATIONS from "~src/operations";
import * as SITE from "~src/site";
import STYLESHEETS from "~src/stylesheets";
import U from "~src/userscript";

import { getAssignmentInfo } from "./utilities/bulk_dates_csv";

const describeFailure = errors.failureDescriber({
  siteName: SITE.NAME,
  extensionName: U.name,
  location: document.location,
});


// ensures user is on correct page
function isMonthView(): boolean {
  const path = window.location.pathname;
  const hash = window.location.hash;

  if (path !== "/calendar") return false;

  // Parse the hash fragment into search parameters, removing leading '#' characters
  const params = new URLSearchParams(hash.replace(/^#+/, ""));
  // Check if the calendar view is set to 'month'
  return params.get("view_name") === "month";
}


function addOrRemoveButton() {

}

function installSpaListeners() {
  // hash changes (Canvas calendar view changes often live here)
  window.addEventListener("hashchange", addOrRemoveButton);

  // route changes (Canvas sometimes uses pushState)
  const _pushState = history.pushState;
  history.pushState = function (...args) {
    // @ts-ignore
    const ret = _pushState.apply(this, args);
    addOrRemoveButton();
    return ret;
  };

  window.addEventListener("popstate", addOrRemoveButton);
}

userscripter.run({
  id: U.id,
  name: U.name,

  initialAction: () => {
    log.log(`${U.name} ${U.version} - Hello world!`);

    

    const start = () => {
      addOrRemoveButton();
      installSpaListeners();

      // Debug helper: only attempt assignment logging once the page has had a chance
      // to load Canvas globals like jQuery ($) and ENV.
      if ((window as any).$) {
        void getAssignmentInfo();
        // void showUnpublishedAssignment();
        
      } else {
        setTimeout(() => {
          if ((window as any).$) {
            void getAssignmentInfo();
            // void showUnpublishedAssignment();

          }
        }, 1000);
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  },

  stylesheets: STYLESHEETS,
  operationsPlan: {
    operations: OPERATIONS,
    interval: CONFIG.OPERATIONS_INTERVAL,
    tryUntil: environment.DOMCONTENTLOADED,
    extraTries: CONFIG.OPERATIONS_EXTRA_TRIES,
    handleFailures: (failures) =>
      failures.forEach(compose(log.error, describeFailure)),
  },
});