import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, ArrowRight } from "lucide-react";

export default function ChatStartForm({ onStart }) {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [postcode, setPostcode] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !dob || !postcode.trim()) return;
    onStart({ name: name.trim(), dob, postcode: postcode.trim() });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-blue-600 px-5 pt-6 pb-8 text-white">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
            <MessageCircle className="h-4 w-4" />
          </div>
          <span className="font-semibold text-sm">Live Chat</span>
        </div>
        <h3 className="text-lg font-bold leading-tight">Hi there 👋</h3>
        <p className="text-blue-100 text-sm mt-1">Please fill in your details to begin.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 p-5 flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Full name *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John Doe"
            className="h-10"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Date of birth *</label>
          <Input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="h-10"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Postcode *</label>
          <Input
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.toUpperCase())}
            placeholder="SW1A 1AA"
            className="h-10"
            required
          />
        </div>
        <Button type="submit" className="mt-auto bg-blue-600 hover:bg-blue-700 h-10 gap-2">
          Start Chat <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}