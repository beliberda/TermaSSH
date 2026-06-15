import { i18n } from '@/i18n';
import { notify } from '@/notify';
import { copyTextToClipboard } from '@utils/clipboard';

export async function copyPathWithNotify(path: string): Promise<void> {
  try {
    await copyTextToClipboard(path);
    notify.success(i18n.t('notify.pathCopied'));
  } catch {
    notify.error(i18n.t('notify.copyPathFailed'));
  }
}
