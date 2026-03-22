import { ALWAYS } from "userscripter/lib/environment";
import { Stylesheets, stylesheet } from "userscripter/lib/stylesheets";

const STYLESHEETS = {
    main: stylesheet({
        condition: ALWAYS,
        css: `
            .fc-day-grid-event {
                border-radius: 10px;
            }

            .mark-assignments-complete-button {
                display: flex;
                justify-content: center;
                gap: 6px;
                margin-left: auto;
                margin-right: auto;
                background-color: rgb(242, 244, 244);
                color: rgb(39, 53, 64);
                font-family: "Lato Extended", Lato, "Helvetica Neue", Helvetica, Arial, sans-serif;
                font-size: 0.875rem;
                font-weight: 400;
                text-align: center;
                text-transform: none;
                padding: 8px 14px;
                border-width: 1px;
                border-style: solid;
                border-color: rgb(232, 234, 236);
                border-radius: 5px;
                box-shadow: none;
            }

            .mark-assignments-complete-button:hover {
                background-color: #e4e8e8;
                // color: #fff;
            }

            .mark-assignments-complete-button.active {
                background-color: #5e6f6f;
                border-color: #475454;
                color: #fff;
            }

            .header-bar-left {
                display: flex;
                flex-direction: row;
                align-items: center;
            }
       
           
        `,
    }),
} as const;

// This trick uncovers type errors in STYLESHEETS while retaining the static knowledge of its properties (so we can still write e.g. STYLESHEETS.foo):
const _: Stylesheets = STYLESHEETS; void _;

export default STYLESHEETS;
