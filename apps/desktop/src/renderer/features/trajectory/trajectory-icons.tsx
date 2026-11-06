// Original icon artwork from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
import type { ReactNode, SVGProps } from 'react'
type IconProps = SVGProps<SVGSVGElement> & { size?: number }
const CheckIconAttributes = { viewBox: '0 0 16 16', fill: 'none', strokeWidth: '1' } as SVGProps<SVGSVGElement>
const CheckIconArtwork = '<path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor"></path>'
export function CheckIcon({ size = 16, ...props }: IconProps) {
  return <svg {...CheckIconAttributes} {...props} width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: CheckIconArtwork }} />
}
const CopyIconAttributes = { viewBox: '0 0 16 16', fill: 'none', strokeWidth: '1' } as SVGProps<SVGSVGElement>
const CopyIconArtwork =
  '<rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" stroke="currentColor"></rect><path d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z" fill="currentColor"></path>'
export function CopyIcon({ size = 16, ...props }: IconProps) {
  return <svg {...CopyIconAttributes} {...props} width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: CopyIconArtwork }} />
}
const WrapTextIconAttributes = { viewBox: '0 0 16 16', fill: 'none', strokeWidth: '1' } as SVGProps<SVGSVGElement>
const WrapTextIconArtwork =
  '<path d="M2.3457 3.19299H13.6541" stroke="currentColor"></path><path d="M2.3457 7.46497H9.19332" stroke="currentColor"></path><path d="M2.3457 11.7369H6.4849" stroke="currentColor"></path><path d="M9.1936 7.46497H11.5183C12.6981 7.46497 13.6544 8.42132 13.6544 9.60103C13.6544 10.7808 12.6981 11.7371 11.5183 11.7371H9.1936" stroke="currentColor"></path><path d="M10.9505 9.7677L9.12262 11.5956C9.04452 11.6737 9.04452 11.8003 9.12262 11.8784L10.9505 13.7063" stroke="currentColor"></path>'
export function WrapTextIcon({ size = 16, ...props }: IconProps) {
  return <svg {...WrapTextIconAttributes} {...props} width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: WrapTextIconArtwork }} />
}
const ChevronRightIconAttributes = { viewBox: '0 0 16 16', fill: 'none', strokeWidth: '1' } as SVGProps<SVGSVGElement>
const ChevronRightIconArtwork = '<path d="M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4" stroke="currentColor"></path>'
export function ChevronRightIcon({ size = 16, ...props }: IconProps) {
  return <svg {...ChevronRightIconAttributes} {...props} width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: ChevronRightIconArtwork }} />
}
const SettingsIconAttributes = { viewBox: '0 0 16 16', fill: 'none', strokeWidth: '1' } as SVGProps<SVGSVGElement>
const SettingsIconArtwork =
  '<path d="M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z" stroke="currentColor"></path><path d="M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0911 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z" stroke="currentColor" stroke-miterlimit="10"></path>'
export function SettingsIcon({ size = 16, ...props }: IconProps) {
  return <svg {...SettingsIconAttributes} {...props} width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: SettingsIconArtwork }} />
}
const UserIconAttributes = { viewBox: '0 0 16 16', fill: 'none', strokeWidth: '1' } as SVGProps<SVGSVGElement>
const UserIconArtwork =
  '<path d="M8 8.25C9.51878 8.25 10.75 7.01878 10.75 5.5C10.75 3.98122 9.51878 2.75 8 2.75C6.48122 2.75 5.25 3.98122 5.25 5.5C5.25 7.01878 6.48122 8.25 8 8.25Z" stroke="currentColor"></path><path d="M2.5 14.5C2.5 11.5 5.25 10.25 8 10.25C10.75 10.25 13.5 11.5 13.5 14.5" stroke="currentColor"></path>'
export function UserIcon({ size = 16, ...props }: IconProps) {
  return <svg {...UserIconAttributes} {...props} width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: UserIconArtwork }} />
}
const SparklesIconAttributes = { viewBox: '0 0 16 16', fill: 'none', strokeWidth: '1' } as SVGProps<SVGSVGElement>
const SparklesIconArtwork =
  '<path d="M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z" stroke="currentColor"></path><path d="M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z" stroke="currentColor"></path><path d="M12.375 10.4418C12.375 11.7751 13.0417 12.4418 14.375 12.4418C13.0417 12.4418 12.375 13.1084 12.375 14.4418C12.375 13.1084 11.7083 12.4418 10.375 12.4418C11.7083 12.4418 12.375 11.7751 12.375 10.4418Z" stroke="currentColor"></path>'
export function SparklesIcon({ size = 16, ...props }: IconProps) {
  return <svg {...SparklesIconAttributes} {...props} width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: SparklesIconArtwork }} />
}

export function WrenchIcon(): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-role-icon="wrench"
      aria-hidden="true"
    >
      <path d="M14 3.3a3.8 3.8 0 0 1-4.8 4.8l-5.1 5.1a1.6 1.6 0 1 1-2.3-2.3l5.1-5.1A3.8 3.8 0 0 1 11.7 1l-2.3 2.3 2.3 2.3L14 3.3Z" />
    </svg>
  )
}

export function ContextIcon(): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      data-role-icon="information"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.7" />
      <circle cx="8" cy="5.5" r=".85" fill="currentColor" stroke="none" />
      <path d="M8 7.75v3.4" strokeWidth="1.8" />
    </svg>
  )
}

export function CompactedIcon(): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-role-icon="compacted"
      aria-hidden="true"
    >
      <path d="m2.5 2.5 3.75 3.75M3 6.25h3.25V3" />
      <path d="m13.5 2.5-3.75 3.75M13 6.25H9.75V3" />
      <path d="m2.5 13.5 3.75-3.75M3 9.75h3.25V13" />
      <path d="m13.5 13.5-3.75-3.75M13 9.75H9.75V13" />
    </svg>
  )
}
