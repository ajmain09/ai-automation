import { getPreviewFacebookPages } from "@/services/preview/store";
import { discoverPages } from "@/services/meta/service";

export type FacebookPageOption = { id: string; name: string };

export interface FacebookConnector {
  discoverPages(): Promise<FacebookPageOption[]>;
}

export class PreviewFacebookConnector implements FacebookConnector {
  async discoverPages() { return getPreviewFacebookPages(); }
}

export class MetaFacebookConnector implements FacebookConnector {
  constructor(private readonly userAccessToken: string) {}
  async discoverPages() { return discoverPages(this.userAccessToken); }
}
