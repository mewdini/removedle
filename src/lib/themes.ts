export const themes = {
    dark: {
        bg: '#121212',
        text: '#ffffff',
        accent: '#3b82f6',
        card: 'rgba(255, 255, 255, 0.05)',
        muted: '#9ca3af',
    },
    white: {
        bg: '#fffdf7',
        text: '#121212',
        accent: '#fdc100',
        card: 'rgba(0, 0, 0, 0.05)',
        muted: '#4b5563',
    },
    foible: {
        bg: '#12141c',
        text: '#dbe5eb',
        accent: '#5b6f9e',
        card: 'rgba(255, 255, 255, 0.05)',
        muted: '#6f7690',
    },
    enclave: {
        bg: '#fbeee3',
        text: '#3f3231',
        accent: '#c97b3d',
        card: 'rgba(0, 0, 0, 0.05)',
        muted: '#8a7263',
    },
    vendetta: {
        bg: '#181210',
        text: '#f0d9c8',
        accent: '#c1571f',
        card: 'rgba(255, 255, 255, 0.05)',
        muted: '#8a5f45',
    },
} as const;

export type ThemeName = keyof typeof themes;
