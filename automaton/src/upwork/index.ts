/**
 * Upwork API Client Module
 *
 * Provides integration with Upwork API for job search, bidding, and messaging.
 */

export {
  UpworkClient,
  type UpworkConfig,
  type SearchParams,
  type UpworkJob,
  type BudgetInfo,
  type ClientInfo,
  type BidProposal,
  type BidResult,
  type Contract,
  type UpworkMessage,
} from "./client.js";

export {
  BidGenerator,
  createBidGenerator,
  type BidTemplate,
  type BidContext,
  type GeneratedBid,
  type PricingConfig,
  type BidGeneratorConfig,
} from "./bid-generator.js";
