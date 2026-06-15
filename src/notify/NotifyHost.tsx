import { Toaster } from 'sonner';
import styles from './NotifyHost.module.css';

export function NotifyHost() {
  return (
    <Toaster
      className={styles.toaster}
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: styles.toast,
          title: styles.title,
          description: styles.description,
          closeButton: styles.closeButton,
        },
      }}
    />
  );
}
