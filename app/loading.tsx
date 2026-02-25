import styles from './loading.module.scss';
import Image from 'next/image';

export default function Loading() {
    return (
        <div className={styles.loadingContainer}>
            <div className={styles.logoWrapper}>
                <Image
                    src="/icon.svg"
                    alt="Loading Arctic Chat"
                    width={90}
                    height={90}
                    priority
                    className={styles.pulsingLogo}
                />
            </div>
            <p className={styles.loadingText}>Loading Arctic Chat...</p>
        </div>
    );
}
