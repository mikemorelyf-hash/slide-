import type { PassengerManifest, RidePool, Route, TelegramUserProfile } from '../domain/types.js';

export function routeIntroMessage(): string {
  return 'Choose a route to find or create a ride pool.';
}

export function openPoolMessage(pool: RidePool, poolSize: number): string {
  return [
    `Open pool found for ${pool.routeName}.`,
    `Passengers confirmed: ${pool.passengerCount}/${poolSize}`,
    'Tap Join Pool to reserve your seat, then confirm payment.'
  ].join('\n');
}

export function noOpenPoolMessage(routeName: string): string {
  return [`No active pool available for ${routeName}.`, 'You can create one and become captain.'].join(
    '\n'
  );
}

export function paymentPromptMessage(pool: RidePool): string {
  return [
    `Pool ${pool.routeName}`,
    `Price: ${formatPrice(pool)}`,
    '',
    'Payment method for MVP: manual confirmation.',
    'Tap I Have Paid after you complete payment.',
    'Your confirmed pool details will be sent only after payment is confirmed.'
  ].join('\n');
}

export function passengerConfirmedMessage(
  pool: RidePool,
  passengerCount: number,
  poolSize: number
): string {
  return [
    'Payment confirmed.',
    `Route: ${pool.routeName}`,
    `Price: ${formatPrice(pool)}`,
    `Pool PIN: ${pool.pinCode}`,
    `Passengers confirmed: ${passengerCount}/${poolSize}`,
    `Drivers will see the job when ${poolSize}/${poolSize} seats are confirmed or when Let's Go Now is approved.`,
    'You will be notified when the pool is ready.'
  ].join('\n');
}

export function poolReadyPassengerMessage(pool: RidePool): string {
  return [
    pool.isEarlyDispatch ? 'Your early dispatch pool is ready.' : 'Your pool is ready.',
    `Route: ${pool.routeName}`,
    `Pool PIN: ${pool.pinCode}`,
    'A driver alert has been sent. You will be notified when a driver accepts.'
  ].join('\n');
}

export function driverGroupAlertMessage(pool: RidePool): string {
  if (pool.isEarlyDispatch) {
    return [
      'Early Dispatch Ride Pool',
      '',
      `Route: ${pool.routeName}`,
      `Passengers: ${pool.passengerCount}`,
      'Status: Early Dispatch',
      '',
      'Ask passengers for the pool PIN after the trip.',
      'Collect the additional cash agreed for early dispatch.',
      '',
      'First driver to accept gets the job.'
    ].join('\n');
  }

  return [
    'New Ride Pool Available',
    '',
    `Route: ${pool.routeName}`,
    `Passengers: ${pool.passengerCount}`,
    'Status: Ready',
    '',
    'First driver to accept gets the job.'
  ].join('\n');
}

export function driverAssignedGroupMessage(pool: RidePool, driverLabel: string): string {
  return [
    `Job taken by ${driverLabel}.`,
    '',
    `Route: ${pool.routeName}`,
    'Please wait for another job soon.'
  ].join('\n');
}

export function driverManifestMessage(pool: RidePool, manifest: PassengerManifest[]): string {
  const passengerLines = manifest.map((passenger, index) => {
    const lines = [
      `${index + 1}. ${passenger.displayName}`,
      `Telegram ID: ${passenger.telegramId}`
    ];

    if (passenger.username) {
      lines.push(`Username: @${passenger.username}`);
    }
    if (passenger.phoneNumber) {
      lines.push(`Phone: ${passenger.phoneNumber}`);
    }

    return lines.join('\n');
  });

  return [
    'You accepted this ride pool.',
    pool.isEarlyDispatch
      ? 'Reminder: this is an early dispatch ride. Collect the agreed additional cash from passengers.'
      : '',
    '',
    `Route: ${pool.routeName}`,
    `Passengers: ${manifest.length}`,
    '',
    passengerLines.join('\n\n'),
    '',
    'Tap I Arrived when you reach the passengers.',
    'After the trip, ask passengers for the 4-digit PIN and send it here.'
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function passengerDriverAssignedMessage(pool: RidePool, driver: TelegramUserProfile): string {
  const lines = [
    'A driver accepted your trip.',
    '',
    `Route: ${pool.routeName}`,
    `Pool PIN: ${pool.pinCode}`,
    `Driver: ${formatProfileName(driver)}`
  ];

  if (driver.username) {
    lines.push(`Telegram: @${driver.username}`);
  }
  if (driver.phoneNumber) {
    lines.push(`Phone: ${driver.phoneNumber}`);
  }

  return lines.join('\n');
}

export function driverArrivalRequestCaptainMessage(
  pool: RidePool,
  driver: TelegramUserProfile
): string {
  const lines = [
    'Driver says they arrived.',
    '',
    `Route: ${pool.routeName}`,
    `Driver: ${formatProfileName(driver)}`,
    '',
    'The captain gets this first, but any confirmed passenger can confirm if the captain is unavailable.'
  ];

  if (driver.username) {
    lines.splice(4, 0, `Telegram: @${driver.username}`);
  }
  if (driver.phoneNumber) {
    lines.splice(driver.username ? 5 : 4, 0, `Phone: ${driver.phoneNumber}`);
  }

  return lines.join('\n');
}

export function driverArrivalRequestSentMessage(pool: RidePool): string {
  return [
    'Arrival request sent to the passengers.',
    `Route: ${pool.routeName}`,
    'Wait for a confirmed passenger to approve arrival before starting the trip.'
  ].join('\n');
}

export function driverArrivalConfirmedPassengerMessage(pool: RidePool): string {
  return [
    'Driver arrival confirmed.',
    `Route: ${pool.routeName}`,
    'You can start the trip now.'
  ].join('\n');
}

export function driverArrivalConfirmedDriverMessage(pool: RidePool): string {
  return [
    'Arrival confirmed by a passenger.',
    `Route: ${pool.routeName}`,
    'Start the trip now. After the trip, send the 4-digit PIN here.'
  ].join('\n');
}

export function driverArrivalRejectedDriverMessage(pool: RidePool): string {
  return [
    'A passenger did not confirm your arrival.',
    `Route: ${pool.routeName}`,
    'Please coordinate with the passengers and tap I Arrived again when you reach them.'
  ].join('\n');
}

export function profilePromptMessage(): string {
  return 'Share your phone number. Your Telegram profile is saved automatically so drivers can contact you when your pool is assigned.';
}

export function profileStatusMessage(profile: TelegramUserProfile | null): string {
  if (!profile) {
    return 'No profile saved yet.';
  }

  return [
    'Profile',
    `Phone: ${profile.phoneNumber ?? 'not shared'}`,
    `Telegram: ${formatTelegramProfile(profile)}`
  ].join('\n');
}

export function earlyDispatchRequestMessage(pool: RidePool): string {
  return [
    'The pool captain wants to dispatch early.',
    '',
    `Route: ${pool.routeName}`,
    `Current passengers: ${pool.passengerCount}`,
    '',
    'Do you accept early dispatch?'
  ].join('\n');
}

export function earlyDispatchStartedMessage(pool: RidePool): string {
  return [
    'Early dispatch request sent.',
    `Route: ${pool.routeName}`,
    'If all current passengers accept, this pool will be sent to drivers.'
  ].join('\n');
}

export function earlyDispatchCancelledMessage(pool: RidePool): string {
  return [`Early dispatch was cancelled for ${pool.routeName}.`, 'The pool will keep waiting.'].join(
    '\n'
  );
}

export function myPoolMessage(pool: RidePool, isCaptain: boolean, poolSize: number): string {
  return [
    'Current Pool',
    `Route: ${pool.routeName}`,
    `Price: ${formatPrice(pool)}`,
    `PIN: ${pool.pinCode}`,
    `Passengers: ${pool.passengerCount}/${poolSize}`,
    `Status: ${pool.status}`,
    isCaptain ? 'Role: captain passenger' : 'Role: passenger'
  ].join('\n');
}

export function tripCompletedPassengerMessage(pool: RidePool): string {
  return [
    'Congrats, your ride is complete.',
    `Route: ${pool.routeName}`,
    'Thanks for riding together with Side.',
    'You saved by pooling.'
  ].join('\n');
}

export function tripCompletedDriverMessage(pool: RidePool): string {
  return [
    'Congrats, trip completed.',
    `Route: ${pool.routeName}`,
    'Thanks for completing this Side ride.',
    'Admin has been notified for payout.'
  ].join('\n');
}

export function repostedDriverAlertMessage(pool: RidePool): string {
  return [
    'Job Reposted',
    '',
    'The previous driver did not arrive on time.',
    '',
    `Route: ${pool.routeName}`,
    `Passengers: ${pool.passengerCount}`,
    '',
    'First driver to accept gets the job.'
  ].join('\n');
}

export function adminPoolSummary(pool: RidePool): string {
  return [
    `#${pool.id} ${pool.routeName}`,
    `status=${pool.status}`,
    `passengers=${pool.passengerCount}`,
    `price=${formatPrice(pool)}`,
    `pin=${pool.pinCode}`,
    pool.driverTelegramId ? `driver=${pool.driverTelegramId}` : 'driver=none',
    pool.isEarlyDispatch ? 'early_dispatch=true' : 'early_dispatch=false'
  ].join(' | ');
}

export function routeButtonLabel(route: Route): string {
  return `${route.name} - ${formatPrice(route)}`;
}

export function adminRouteSummary(route: Route): string {
  return [
    `#${route.id} ${route.name}`,
    `price=${formatPrice(route)}`,
    `active=${route.isActive}`
  ].join(' | ');
}

export function formatPrice(price: Pick<Route | RidePool, 'priceAmount' | 'priceCurrency'>): string {
  if (price.priceAmount === null) {
    return 'not set';
  }

  return `${formatAmount(price.priceAmount)} ${price.priceCurrency}`;
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function formatProfileName(profile: TelegramUserProfile): string {
  const fullName = `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim();
  if (fullName) {
    return fullName;
  }

  if (profile.username) {
    return `@${profile.username}`;
  }

  return `Telegram ${profile.telegramId}`;
}

function formatTelegramProfile(profile: TelegramUserProfile): string {
  if (profile.username) {
    return `@${profile.username}`;
  }

  return formatProfileName(profile);
}
