import React from 'react';
import ReactDOM from 'react-dom/client';
import SuperTokens, { SuperTokensWrapper } from 'supertokens-auth-react';
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
    Session.init({
      // Use header-based auth to avoid Azure SWA cookie issues
      tokenTransferMethod: "header"
    })
  ]
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <SuperTokensWrapper>
      <App />
    </SuperTokensWrapper>
  </React.StrictMode>
);
