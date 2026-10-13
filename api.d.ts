import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { CreateEmailTelegramLink200, EmailAccountStatus, GetMiniAppCalendarEventsParams, HealthStatus, HostedPayment, ListShareInput, MiniAppActionInput, MiniAppCalendarEvents, MiniAppCalendarStatus, MiniAppData, MiniAppProfile, MiniAppProfileInput, OpenTasks, RegistrationStatus, SharedLists, TelegramOnboarding, TelegramVerification, WebsiteRegistration } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getGetTelegramOnboardingUrl: () => string;
/**
 * Public Telegram-only bot connection, without a database or external API lookup.
 */
export declare const getTelegramOnboarding: (options?: Parameters<typeof customFetch>[1]) => Promise<TelegramOnboarding>;
export declare const getGetTelegramOnboardingQueryKey: () => readonly ["/api/onboarding/channels"];
export declare const getGetTelegramOnboardingQueryOptions: <TData = Awaited<ReturnType<typeof getTelegramOnboarding>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTelegramOnboarding>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTelegramOnboarding>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTelegramOnboardingQueryResult = NonNullable<Awaited<ReturnType<typeof getTelegramOnboarding>>>;
export type GetTelegramOnboardingQueryError = ErrorType<unknown>;
export declare function useGetTelegramOnboarding<TData = Awaited<ReturnType<typeof getTelegramOnboarding>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTelegramOnboarding>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: Parameters<typeof customFetch>[1]) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getRegisterWebsiteUserUrl: () => string;
export declare const registerWebsiteUser: (websiteRegistration: WebsiteRegistration, options?: Parameters<typeof customFetch>[1]) => Promise<RegistrationStatus>;
export declare const getRegisterWebsiteUserMutationKey: () => readonly ["registerWebsiteUser"];
export declare const getRegisterWebsiteUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerWebsiteUser>>, TError, RegisterWebsiteUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof registerWebsiteUser>>, TError, RegisterWebsiteUserMutationVariables, TContext>;
export type RegisterWebsiteUserMutationResult = NonNullable<Awaited<ReturnType<typeof registerWebsiteUser>>>;
export type RegisterWebsiteUserMutationBody = BodyType<WebsiteRegistration>;
export type RegisterWebsiteUserMutationError = ErrorType<unknown>;
export type RegisterWebsiteUserMutationVariables = {
    data: BodyType<WebsiteRegistration>;
};
export declare const useRegisterWebsiteUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerWebsiteUser>>, TError, RegisterWebsiteUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof registerWebsiteUser>>, TError, RegisterWebsiteUserMutationVariables, TContext>;
export declare const getGetWebsiteRegistrationUrl: () => string;
export declare const getWebsiteRegistration: (options?: Parameters<typeof customFetch>[1]) => Promise<RegistrationStatus>;
export declare const getGetWebsiteRegistrationQueryKey: () => readonly ["/api/registration"];
export declare const getGetWebsiteRegistrationQueryOptions: <TData = Awaited<ReturnType<typeof getWebsiteRegistration>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWebsiteRegistration>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getWebsiteRegistration>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetWebsiteRegistrationQueryResult = NonNullable<Awaited<ReturnType<typeof getWebsiteRegistration>>>;
export type GetWebsiteRegistrationQueryError = ErrorType<unknown>;
export declare function useGetWebsiteRegistration<TData = Awaited<ReturnType<typeof getWebsiteRegistration>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWebsiteRegistration>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getResetWebsiteRegistrationUrl: () => string;
export declare const resetWebsiteRegistration: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getResetWebsiteRegistrationMutationKey: () => readonly ["resetWebsiteRegistration"];
export declare const getResetWebsiteRegistrationMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetWebsiteRegistration>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof resetWebsiteRegistration>>, TError, void, TContext>;
export type ResetWebsiteRegistrationMutationResult = NonNullable<Awaited<ReturnType<typeof resetWebsiteRegistration>>>;
export type ResetWebsiteRegistrationMutationError = ErrorType<unknown>;
export declare const useResetWebsiteRegistration: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetWebsiteRegistration>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof resetWebsiteRegistration>>, TError, void, TContext>;
export declare const getVerifyWebsiteRegistrationUrl: () => string;
export declare const verifyWebsiteRegistration: (telegramVerification: TelegramVerification, options?: Parameters<typeof customFetch>[1]) => Promise<RegistrationStatus>;
export declare const getVerifyWebsiteRegistrationMutationKey: () => readonly ["verifyWebsiteRegistration"];
export declare const getVerifyWebsiteRegistrationMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyWebsiteRegistration>>, TError, VerifyWebsiteRegistrationMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof verifyWebsiteRegistration>>, TError, VerifyWebsiteRegistrationMutationVariables, TContext>;
export type VerifyWebsiteRegistrationMutationResult = NonNullable<Awaited<ReturnType<typeof verifyWebsiteRegistration>>>;
export type VerifyWebsiteRegistrationMutationBody = BodyType<TelegramVerification>;
export type VerifyWebsiteRegistrationMutationError = ErrorType<unknown>;
export type VerifyWebsiteRegistrationMutationVariables = {
    data: BodyType<TelegramVerification>;
};
export declare const useVerifyWebsiteRegistration: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyWebsiteRegistration>>, TError, VerifyWebsiteRegistrationMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof verifyWebsiteRegistration>>, TError, VerifyWebsiteRegistrationMutationVariables, TContext>;
export declare const getCreateSubscriptionCheckoutUrl: () => string;
export declare const createSubscriptionCheckout: (options?: Parameters<typeof customFetch>[1]) => Promise<HostedPayment>;
export declare const getCreateSubscriptionCheckoutMutationKey: () => readonly ["createSubscriptionCheckout"];
export declare const getCreateSubscriptionCheckoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createSubscriptionCheckout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createSubscriptionCheckout>>, TError, void, TContext>;
export type CreateSubscriptionCheckoutMutationResult = NonNullable<Awaited<ReturnType<typeof createSubscriptionCheckout>>>;
export type CreateSubscriptionCheckoutMutationError = ErrorType<unknown>;
export declare const useCreateSubscriptionCheckout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createSubscriptionCheckout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createSubscriptionCheckout>>, TError, void, TContext>;
export declare const getCreateSubscriptionPortalUrl: () => string;
export declare const createSubscriptionPortal: (options?: Parameters<typeof customFetch>[1]) => Promise<HostedPayment>;
export declare const getCreateSubscriptionPortalMutationKey: () => readonly ["createSubscriptionPortal"];
export declare const getCreateSubscriptionPortalMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createSubscriptionPortal>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createSubscriptionPortal>>, TError, void, TContext>;
export type CreateSubscriptionPortalMutationResult = NonNullable<Awaited<ReturnType<typeof createSubscriptionPortal>>>;
export type CreateSubscriptionPortalMutationError = ErrorType<unknown>;
export declare const useCreateSubscriptionPortal: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createSubscriptionPortal>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createSubscriptionPortal>>, TError, void, TContext>;
export declare const getGetOpenTasksUrl: () => string;
/**
 * @summary Open tasks only, authorized by Telegram identity and active access
 */
export declare const getOpenTasks: (options?: Parameters<typeof customFetch>[1]) => Promise<OpenTasks>;
export declare const getGetOpenTasksQueryKey: () => readonly ["/api/tasks"];
export declare const getGetOpenTasksQueryOptions: <TData = Awaited<ReturnType<typeof getOpenTasks>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpenTasks>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOpenTasks>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOpenTasksQueryResult = NonNullable<Awaited<ReturnType<typeof getOpenTasks>>>;
export type GetOpenTasksQueryError = ErrorType<void>;
/**
 * @summary Open tasks only, authorized by Telegram identity and active access
 */
export declare function useGetOpenTasks<TData = Awaited<ReturnType<typeof getOpenTasks>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpenTasks>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetMiniAppDataUrl: () => string;
/**
 * @summary Telegram-signed, subscription-authorized personal data
 */
export declare const getMiniAppData: (options?: Parameters<typeof customFetch>[1]) => Promise<MiniAppData>;
export declare const getGetMiniAppDataQueryKey: () => readonly ["/api/mini-app/data"];
export declare const getGetMiniAppDataQueryOptions: <TData = Awaited<ReturnType<typeof getMiniAppData>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMiniAppData>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMiniAppData>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMiniAppDataQueryResult = NonNullable<Awaited<ReturnType<typeof getMiniAppData>>>;
export type GetMiniAppDataQueryError = ErrorType<unknown>;
/**
 * @summary Telegram-signed, subscription-authorized personal data
 */
export declare function useGetMiniAppData<TData = Awaited<ReturnType<typeof getMiniAppData>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMiniAppData>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateMiniAppProfileUrl: () => string;
export declare const updateMiniAppProfile: (miniAppProfileInput: MiniAppProfileInput, options?: Parameters<typeof customFetch>[1]) => Promise<MiniAppProfile>;
export declare const getUpdateMiniAppProfileMutationKey: () => readonly ["updateMiniAppProfile"];
export declare const getUpdateMiniAppProfileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateMiniAppProfile>>, TError, UpdateMiniAppProfileMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateMiniAppProfile>>, TError, UpdateMiniAppProfileMutationVariables, TContext>;
export type UpdateMiniAppProfileMutationResult = NonNullable<Awaited<ReturnType<typeof updateMiniAppProfile>>>;
export type UpdateMiniAppProfileMutationBody = BodyType<MiniAppProfileInput>;
export type UpdateMiniAppProfileMutationError = ErrorType<unknown>;
export type UpdateMiniAppProfileMutationVariables = {
    data: BodyType<MiniAppProfileInput>;
};
export declare const useUpdateMiniAppProfile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateMiniAppProfile>>, TError, UpdateMiniAppProfileMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateMiniAppProfile>>, TError, UpdateMiniAppProfileMutationVariables, TContext>;
export declare const getRunMiniAppActionUrl: () => string;
export declare const runMiniAppAction: (miniAppActionInput: MiniAppActionInput, options?: Parameters<typeof customFetch>[1]) => Promise<MiniAppData>;
export declare const getRunMiniAppActionMutationKey: () => readonly ["runMiniAppAction"];
export declare const getRunMiniAppActionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runMiniAppAction>>, TError, RunMiniAppActionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof runMiniAppAction>>, TError, RunMiniAppActionMutationVariables, TContext>;
export type RunMiniAppActionMutationResult = NonNullable<Awaited<ReturnType<typeof runMiniAppAction>>>;
export type RunMiniAppActionMutationBody = BodyType<MiniAppActionInput>;
export type RunMiniAppActionMutationError = ErrorType<unknown>;
export type RunMiniAppActionMutationVariables = {
    data: BodyType<MiniAppActionInput>;
};
export declare const useRunMiniAppAction: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runMiniAppAction>>, TError, RunMiniAppActionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof runMiniAppAction>>, TError, RunMiniAppActionMutationVariables, TContext>;
export declare const getGetMiniAppCalendarStatusUrl: () => string;
export declare const getMiniAppCalendarStatus: (options?: Parameters<typeof customFetch>[1]) => Promise<MiniAppCalendarStatus>;
export declare const getGetMiniAppCalendarStatusQueryKey: () => readonly ["/api/mini-app/calendar/status"];
export declare const getGetMiniAppCalendarStatusQueryOptions: <TData = Awaited<ReturnType<typeof getMiniAppCalendarStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMiniAppCalendarStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMiniAppCalendarStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMiniAppCalendarStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getMiniAppCalendarStatus>>>;
export type GetMiniAppCalendarStatusQueryError = ErrorType<unknown>;
export declare function useGetMiniAppCalendarStatus<TData = Awaited<ReturnType<typeof getMiniAppCalendarStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMiniAppCalendarStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getConnectMiniAppCalendarUrl: () => string;
export declare const connectMiniAppCalendar: (options?: Parameters<typeof customFetch>[1]) => Promise<HostedPayment>;
export declare const getConnectMiniAppCalendarMutationKey: () => readonly ["connectMiniAppCalendar"];
export declare const getConnectMiniAppCalendarMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof connectMiniAppCalendar>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof connectMiniAppCalendar>>, TError, void, TContext>;
export type ConnectMiniAppCalendarMutationResult = NonNullable<Awaited<ReturnType<typeof connectMiniAppCalendar>>>;
export type ConnectMiniAppCalendarMutationError = ErrorType<unknown>;
export declare const useConnectMiniAppCalendar: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof connectMiniAppCalendar>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof connectMiniAppCalendar>>, TError, void, TContext>;
export declare const getGetMiniAppCalendarEventsUrl: (params: GetMiniAppCalendarEventsParams) => string;
export declare const getMiniAppCalendarEvents: (params: GetMiniAppCalendarEventsParams, options?: Parameters<typeof customFetch>[1]) => Promise<MiniAppCalendarEvents>;
export declare const getGetMiniAppCalendarEventsQueryKey: (params?: GetMiniAppCalendarEventsParams) => readonly ["/api/mini-app/calendar/events", ...GetMiniAppCalendarEventsParams[]];
export declare const getGetMiniAppCalendarEventsQueryOptions: <TData = Awaited<ReturnType<typeof getMiniAppCalendarEvents>>, TError = ErrorType<unknown>>(params: GetMiniAppCalendarEventsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMiniAppCalendarEvents>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMiniAppCalendarEvents>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMiniAppCalendarEventsQueryResult = NonNullable<Awaited<ReturnType<typeof getMiniAppCalendarEvents>>>;
export type GetMiniAppCalendarEventsQueryError = ErrorType<unknown>;
export declare function useGetMiniAppCalendarEvents<TData = Awaited<ReturnType<typeof getMiniAppCalendarEvents>>, TError = ErrorType<unknown>>(params: GetMiniAppCalendarEventsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMiniAppCalendarEvents>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDisconnectMiniAppCalendarUrl: () => string;
export declare const disconnectMiniAppCalendar: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getDisconnectMiniAppCalendarMutationKey: () => readonly ["disconnectMiniAppCalendar"];
export declare const getDisconnectMiniAppCalendarMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof disconnectMiniAppCalendar>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof disconnectMiniAppCalendar>>, TError, void, TContext>;
export type DisconnectMiniAppCalendarMutationResult = NonNullable<Awaited<ReturnType<typeof disconnectMiniAppCalendar>>>;
export type DisconnectMiniAppCalendarMutationError = ErrorType<unknown>;
export declare const useDisconnectMiniAppCalendar: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof disconnectMiniAppCalendar>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof disconnectMiniAppCalendar>>, TError, void, TContext>;
export declare const getGetEmailAccountUrl: () => string;
export declare const getEmailAccount: (options?: Parameters<typeof customFetch>[1]) => Promise<EmailAccountStatus>;
export declare const getGetEmailAccountQueryKey: () => readonly ["/api/email-auth/me"];
export declare const getGetEmailAccountQueryOptions: <TData = Awaited<ReturnType<typeof getEmailAccount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getEmailAccount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getEmailAccount>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetEmailAccountQueryResult = NonNullable<Awaited<ReturnType<typeof getEmailAccount>>>;
export type GetEmailAccountQueryError = ErrorType<unknown>;
export declare function useGetEmailAccount<TData = Awaited<ReturnType<typeof getEmailAccount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getEmailAccount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateEmailTelegramLinkUrl: () => string;
export declare const createEmailTelegramLink: (options?: Parameters<typeof customFetch>[1]) => Promise<CreateEmailTelegramLink200>;
export declare const getCreateEmailTelegramLinkMutationKey: () => readonly ["createEmailTelegramLink"];
export declare const getCreateEmailTelegramLinkMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createEmailTelegramLink>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createEmailTelegramLink>>, TError, void, TContext>;
export type CreateEmailTelegramLinkMutationResult = NonNullable<Awaited<ReturnType<typeof createEmailTelegramLink>>>;
export type CreateEmailTelegramLinkMutationError = ErrorType<unknown>;
export declare const useCreateEmailTelegramLink: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createEmailTelegramLink>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createEmailTelegramLink>>, TError, void, TContext>;
export declare const getWatchMiniAppChangesUrl: () => string;
export declare const watchMiniAppChanges: (options?: Parameters<typeof customFetch>[1]) => Promise<string>;
export declare const getWatchMiniAppChangesQueryKey: () => readonly ["/api/mini-app/changes"];
export declare const getWatchMiniAppChangesQueryOptions: <TData = Awaited<ReturnType<typeof watchMiniAppChanges>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof watchMiniAppChanges>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof watchMiniAppChanges>>, TError, TData> & {
    queryKey: QueryKey;
};
export type WatchMiniAppChangesQueryResult = NonNullable<Awaited<ReturnType<typeof watchMiniAppChanges>>>;
export type WatchMiniAppChangesQueryError = ErrorType<unknown>;
export declare function useWatchMiniAppChanges<TData = Awaited<ReturnType<typeof watchMiniAppChanges>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof watchMiniAppChanges>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetMiniAppSharesUrl: () => string;
export declare const getMiniAppShares: (options?: Parameters<typeof customFetch>[1]) => Promise<SharedLists>;
export declare const getGetMiniAppSharesQueryKey: () => readonly ["/api/mini-app/shares"];
export declare const getGetMiniAppSharesQueryOptions: <TData = Awaited<ReturnType<typeof getMiniAppShares>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMiniAppShares>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMiniAppShares>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMiniAppSharesQueryResult = NonNullable<Awaited<ReturnType<typeof getMiniAppShares>>>;
export type GetMiniAppSharesQueryError = ErrorType<unknown>;
export declare function useGetMiniAppShares<TData = Awaited<ReturnType<typeof getMiniAppShares>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMiniAppShares>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateMiniAppShareUrl: () => string;
export declare const createMiniAppShare: (listShareInput: ListShareInput, options?: Parameters<typeof customFetch>[1]) => Promise<SharedLists>;
export declare const getCreateMiniAppShareMutationKey: () => readonly ["createMiniAppShare"];
export declare const getCreateMiniAppShareMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createMiniAppShare>>, TError, CreateMiniAppShareMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createMiniAppShare>>, TError, CreateMiniAppShareMutationVariables, TContext>;
export type CreateMiniAppShareMutationResult = NonNullable<Awaited<ReturnType<typeof createMiniAppShare>>>;
export type CreateMiniAppShareMutationBody = BodyType<ListShareInput>;
export type CreateMiniAppShareMutationError = ErrorType<unknown>;
export type CreateMiniAppShareMutationVariables = {
    data: BodyType<ListShareInput>;
};
export declare const useCreateMiniAppShare: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createMiniAppShare>>, TError, CreateMiniAppShareMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createMiniAppShare>>, TError, CreateMiniAppShareMutationVariables, TContext>;
export declare const getRevokeMiniAppShareUrl: (id: string) => string;
export declare const revokeMiniAppShare: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<SharedLists>;
export declare const getRevokeMiniAppShareMutationKey: () => readonly ["revokeMiniAppShare"];
export declare const getRevokeMiniAppShareMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof revokeMiniAppShare>>, TError, RevokeMiniAppShareMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof revokeMiniAppShare>>, TError, RevokeMiniAppShareMutationVariables, TContext>;
export type RevokeMiniAppShareMutationResult = NonNullable<Awaited<ReturnType<typeof revokeMiniAppShare>>>;
export type RevokeMiniAppShareMutationError = ErrorType<unknown>;
export type RevokeMiniAppShareMutationVariables = {
    id: string;
};
export declare const useRevokeMiniAppShare: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof revokeMiniAppShare>>, TError, RevokeMiniAppShareMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof revokeMiniAppShare>>, TError, RevokeMiniAppShareMutationVariables, TContext>;
export declare const getRunMiniAppSharedActionUrl: (id: string) => string;
export declare const runMiniAppSharedAction: (id: string, miniAppActionInput: MiniAppActionInput, options?: Parameters<typeof customFetch>[1]) => Promise<SharedLists>;
export declare const getRunMiniAppSharedActionMutationKey: () => readonly ["runMiniAppSharedAction"];
export declare const getRunMiniAppSharedActionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runMiniAppSharedAction>>, TError, RunMiniAppSharedActionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof runMiniAppSharedAction>>, TError, RunMiniAppSharedActionMutationVariables, TContext>;
export type RunMiniAppSharedActionMutationResult = NonNullable<Awaited<ReturnType<typeof runMiniAppSharedAction>>>;
export type RunMiniAppSharedActionMutationBody = BodyType<MiniAppActionInput>;
export type RunMiniAppSharedActionMutationError = ErrorType<unknown>;
export type RunMiniAppSharedActionMutationVariables = {
    id: string;
    data: BodyType<MiniAppActionInput>;
};
export declare const useRunMiniAppSharedAction: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runMiniAppSharedAction>>, TError, RunMiniAppSharedActionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof runMiniAppSharedAction>>, TError, RunMiniAppSharedActionMutationVariables, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map