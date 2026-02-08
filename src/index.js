import React from 'react';
import ReactDOM from 'react-dom/client';
import SuperTokens from 'supertokens-auth-react';
import ThirdParty from 'supertokens-auth-react/recipe/thirdparty';
import Session from 'supertokens-auth-react/recipe/session';
import './index.css';
import App from './App';

// SuperTokens 初始化
SuperTokens.init({
  appInfo: {
    appName: "一之宮巡礼",
    apiDomain: window.location.origin,
    websiteDomain: window.location.origin,
    apiBasePath: "/api/auth",
    websiteBasePath: "/auth"
  },
  recipeList: [
    ThirdParty.init({
      signInAndUpFeature: {
        providers: [
          ThirdParty.Google.init()
        ]
      }
    }),
    Session.init()
  ]
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
