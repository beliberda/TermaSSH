import { useTranslation } from 'react-i18next';
import styles from './FileBreadcrumbs.module.css';

interface Crumb {
  label: string;
  path: string;
}

interface FileBreadcrumbsProps {
  crumbs: Crumb[];
  currentPath: string;
  onNavigate: (path: string) => void;
  onCopyPath: (path: string) => void;
}

export function FileBreadcrumbs({
  crumbs,
  currentPath,
  onNavigate,
  onCopyPath,
}: FileBreadcrumbsProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.bar}>
      <nav className={styles.crumbs} aria-label={t('files.breadcrumbs.path')}>
        {crumbs.map((crumb, i) => (
          <span key={crumb.path} className={styles.item}>
            {i > 0 && <span className={styles.sep}>/</span>}
            <button
              type="button"
              className={styles.link}
              onClick={() => onNavigate(crumb.path)}
              title={crumb.path}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>
      <button
        type="button"
        className={styles.copyBtn}
        title={t('files.breadcrumbs.copyPath')}
        aria-label={t('files.breadcrumbs.copyPath')}
        onClick={() => onCopyPath(currentPath)}
      >
        ⧉
      </button>
    </div>
  );
}
