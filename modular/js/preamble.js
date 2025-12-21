/**
         * Application Build Information
         * Update this variable to change the footer in Appearance Settings.
         */
        const APP_BUILD_TIMESTAMP = "Version: 2025.12.15 - 16:00 CST";


        /**
         * HTML Sanitizer
         */

        const debounce = (func, wait) => { let timeout; return function (...args) { const context = this; clearTimeout(timeout); timeout = setTimeout(() => func.apply(context, args), wait); }; };