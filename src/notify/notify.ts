import { toast } from 'sonner';

export type NotifyOptions = {
  description?: string;
  duration?: number;
  id?: string | number;
};

export const notify = {
  message(message: string, options?: NotifyOptions) {
    return toast(message, options);
  },

  success(message: string, options?: NotifyOptions) {
    return toast.success(message, options);
  },

  error(message: string, options?: NotifyOptions) {
    return toast.error(message, options);
  },

  info(message: string, options?: NotifyOptions) {
    return toast.info(message, options);
  },

  warning(message: string, options?: NotifyOptions) {
    return toast.warning(message, options);
  },

  loading(message: string, options?: NotifyOptions) {
    return toast.loading(message, options);
  },

  promise<T>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((value: T) => string);
      error: string | ((error: unknown) => string);
    },
  ) {
    return toast.promise(promise, messages);
  },

  dismiss(id?: string | number) {
    toast.dismiss(id);
  },
};
