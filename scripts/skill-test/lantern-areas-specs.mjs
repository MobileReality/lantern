export const PLATFORM_KINDS = { storefront: 'web', api: 'backend', app: 'mobile', webapp: 'web', server: 'backend' };

const feature = (id, fn, text, onApp = false) => ({ id, fn, text, onApp });

export const SHOP = {
  platforms: ['storefront', 'api', 'app'],
  parts: { storefront: 5, api: 5, app: 2 },
  features: [
    feature('product-listing', 'catalogue', 'Shoppers browse the product catalogue by category with photos and prices.', true),
    feature('product-search', 'catalogue', 'Shoppers search the catalogue for a product by name, brand or price.', true),
    feature('shopping-cart', 'ordering', 'Shoppers keep items in a cart and change quantities before they order.', true),
    feature('order-placement', 'ordering', 'Shoppers confirm the delivery address and place an order for the cart.', true),
    feature('order-tracking', 'ordering', 'Shoppers follow a placed order until the parcel reaches their door.', true),
    feature('card-payment', 'payments', 'Shoppers pay an order with a bank card and see whether the payment worked.'),
    feature('refunds', 'payments', "Staff send the money for a returned order back to the customer's card."),
    feature('sign-in', 'accounts', 'Customers sign in to their account with an email address and a password.', true),
    feature('profile-settings', 'accounts', 'Customers edit their profile, saved addresses and account details.'),
    feature('order-notifications', 'messaging', 'Customers get an email whenever the state of their order changes.', true),
    feature('support-chat', 'messaging', 'Customers chat with the support team about a question on an order.'),
    feature('landing-pages', 'site', 'Visitors read the public pages that introduce the store and its offers.'),
    feature('store-locator', 'site', 'Visitors find the nearest shop to them on a public map of all stores.'),
  ],
  tree: {
    'product-browsing': ['product-listing', 'product-search'],
    'order-handling': ['shopping-cart', 'order-placement', 'order-tracking'],
    'payment-handling': ['card-payment', 'refunds'],
    'customer-accounts': ['sign-in', 'profile-settings'],
    'customer-messages': ['order-notifications', 'support-chat'],
    'public-site': ['landing-pages', 'store-locator'],
  },
  purposes: {
    'product-browsing': 'Finding and browsing the product catalogue',
    'order-handling': 'Putting items in a cart, placing orders and following them to the door',
    'payment-handling': 'Taking card payments and sending money back after returns',
    'customer-accounts': 'Signing in and keeping customer account details up to date',
    'customer-messages': 'Telling customers about their orders and chatting with support',
    'public-site': 'The public pages that introduce the store and show where its shops are',
  },
  decoyTree: {
    'catalogue-showcase': ['product-listing', 'landing-pages', 'support-chat'],
    'order-basket': ['shopping-cart', 'sign-in', 'refunds', 'store-locator'],
    'payment-desk': ['card-payment', 'order-placement', 'profile-settings'],
    'customer-updates': ['order-notifications', 'order-tracking', 'product-search'],
  },
  decoyPurposes: {
    'catalogue-showcase': 'Browsing the product catalogue by category and price',
    'order-basket': 'Collecting items in a cart and placing orders',
    'payment-desk': 'Paying by card and keeping saved payment details',
    'customer-updates': 'Telling customers when orders change and where parcels are',
  },
  sevenTree: {
    'product-browsing': ['product-listing', 'product-search'],
    'cart-checkout': ['shopping-cart', 'order-placement'],
    'parcel-delivery': ['order-tracking'],
    'payment-handling': ['card-payment', 'refunds'],
    'customer-accounts': ['sign-in', 'profile-settings'],
    'customer-messages': ['order-notifications', 'support-chat'],
    'public-site': ['landing-pages', 'store-locator'],
  },
  sevenPurposes: {
    'product-browsing': 'Finding and browsing the product catalogue',
    'cart-checkout': 'Keeping items in a cart and checking out an order',
    'parcel-delivery': 'Tracking placed parcels until they reach the door',
    'payment-handling': 'Taking card payments and sending money back after returns',
    'customer-accounts': 'Signing in and keeping customer account details up to date',
    'customer-messages': 'Telling customers about their orders and chatting with support',
    'public-site': 'The public pages that introduce the store and show where its shops are',
  },
  rebuiltTree: {
    'product-browsing': ['product-listing', 'product-search'],
    'order-handling': ['shopping-cart', 'order-placement', 'order-tracking'],
    'payment-handling': ['card-payment', 'refunds'],
    'customer-accounts': ['sign-in', 'profile-settings'],
    'customer-messages': ['order-notifications', 'support-chat'],
    'public-site': ['landing-pages', 'store-locator'],
    'staff-planning': ['staff-rota'],
  },
  rebuiltPurposes: {
    'product-browsing': 'Finding and browsing the product catalogue',
    'order-handling': 'Putting items in a cart, placing orders and following them to the door',
    'payment-handling': 'Taking card payments and sending money back after returns',
    'customer-accounts': 'Signing in and keeping customer account details up to date',
    'customer-messages': 'Telling customers about their orders and chatting with support',
    'public-site': 'The public pages that introduce the store and show where its shops are',
    'staff-planning': 'Planning which staff work which shifts in the warehouse',
  },
  eightTree: {
    'product-browsing': ['product-listing', 'product-search'],
    'order-handling': ['shopping-cart', 'order-placement', 'order-tracking'],
    'payment-handling': ['card-payment', 'refunds'],
    'customer-accounts': ['sign-in', 'profile-settings'],
    'customer-messages': ['order-notifications', 'support-chat'],
    'landing-content': ['landing-pages'],
    'shop-finder': ['store-locator'],
    'staff-planning': ['staff-rota'],
  },
  eightPurposes: {
    'product-browsing': 'Finding and browsing the product catalogue',
    'order-handling': 'Putting items in a cart, placing orders and following them to the door',
    'payment-handling': 'Taking card payments and sending money back after returns',
    'customer-accounts': 'Signing in and keeping customer account details up to date',
    'customer-messages': 'Telling customers about their orders and chatting with support',
    'landing-content': 'The public pages that introduce the store and its offers',
    'shop-finder': 'Finding the nearest shop on a public map of all stores',
    'staff-planning': 'Planning which staff work which shifts in the warehouse',
  },
  layersTree: {
    'frontend-modules': ['product-listing', 'product-search', 'shopping-cart', 'sign-in', 'profile-settings', 'landing-pages', 'store-locator'],
    'backend-services': ['order-placement', 'order-tracking', 'card-payment', 'refunds', 'order-notifications', 'support-chat'],
  },
  layersPurposes: {
    'frontend-modules': 'The frontend modules that draw the screens',
    'backend-services': 'The backend services that do the work',
  },
  hubFeature: 'sign-in',
  crossLines: [['order-placement', 'card-payment', 2], ['order-placement', 'order-notifications', 1], ['refunds', 'order-tracking', 1]],
  decoyGroups: [
    ['product-listing', 'landing-pages', 'support-chat'],
    ['shopping-cart', 'sign-in', 'refunds', 'store-locator'],
    ['card-payment', 'order-placement', 'profile-settings'],
    ['order-notifications', 'order-tracking', 'product-search'],
  ],
};

export const OVERFLOW_FEATURE = feature('staff-rota', 'staff', 'Managers plan which staff work which shifts in the warehouse.');
export const OVERFLOW_LINES = [[OVERFLOW_FEATURE.id, 'sign-in', 1]];

export const STUDIO = {
  platforms: ['webapp', 'server'],
  parts: { webapp: 6, server: 6 },
  features: [
    feature('class-schedule', 'classes', 'Members browse the weekly timetable of classes and rooms.'),
    feature('class-details', 'classes', 'Members read what a class involves, its level and its coach.'),
    feature('seat-booking', 'bookings', 'Members reserve a place in a class and cancel it again.'),
    feature('waiting-list', 'bookings', 'Members join a queue for a full class and are told when a place frees up.'),
    feature('check-in', 'bookings', 'Members show a code at the door to enter the class they booked.'),
    feature('plan-signup', 'membership', 'Visitors choose a membership plan and join the studio.'),
    feature('plan-changes', 'membership', 'Members pause, upgrade or end their membership plan.'),
    feature('monthly-billing', 'billing', 'The studio charges each membership fee every month by card.'),
    feature('invoice-history', 'billing', 'Members download invoices for the fees they paid.'),
    feature('coach-profiles', 'coaching', 'Members read about the coaches who teach at the studio.'),
    feature('coach-reviews', 'coaching', 'Members rate a coach after a class and read ratings.'),
    feature('progress-tracking', 'coaching', 'Members log workouts and follow their progress over weeks.'),
  ],
  tree: {
    'class-timetable': ['class-schedule', 'class-details'],
    'class-booking': ['seat-booking', 'waiting-list', 'check-in'],
    'membership-plans': ['plan-signup', 'plan-changes'],
    'fee-billing': ['monthly-billing', 'invoice-history'],
    'coaching-progress': ['coach-profiles', 'coach-reviews', 'progress-tracking'],
  },
  purposes: {
    'class-timetable': 'The weekly timetable of classes, rooms and what each class involves',
    'class-booking': 'Reserving a place in a class, waiting for one and showing a code at the door',
    'membership-plans': 'Choosing, pausing, upgrading or ending a membership plan',
    'fee-billing': 'Charging membership fees by card each month and keeping invoices',
    'coaching-progress': 'Coaches, their ratings and the workouts members log',
  },
  layersTree: {
    'frontend-modules': ['class-schedule', 'class-details', 'seat-booking', 'waiting-list', 'check-in', 'plan-signup'],
    'backend-services': ['plan-changes', 'monthly-billing', 'invoice-history', 'coach-profiles', 'coach-reviews', 'progress-tracking'],
  },
  layersPurposes: {
    'frontend-modules': 'The frontend modules that draw the screens',
    'backend-services': 'The backend services that do the work',
  },
  hubFeature: null,
  crossLines: [['check-in', 'plan-changes', 1], ['monthly-billing', 'plan-signup', 1], ['progress-tracking', 'seat-booking', 1]],
};

export const SMALL_FEATURES = ['product-listing', 'shopping-cart', 'card-payment', 'sign-in', 'order-notifications', 'landing-pages'];
export const SMALL_PARTS = { storefront: 3, api: 3, app: 1 };
