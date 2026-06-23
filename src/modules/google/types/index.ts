export type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export type GoogleUserInfoResponse = {
  email?: string;
  email_verified?: boolean;
  name?: string;
};

export type GooglePeopleResponse = {
  connections?: GooglePerson[];
};

export type GooglePerson = {
  emailAddresses?: Array<{ value?: string }>;
  names?: Array<{ displayName?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
};

export type GoogleOAuthState = {
  hostId: string;
  nonce: string;
  purpose: 'google_oauth';
};
