import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight } from "lucide-react";

export default function InlineDetailsForm({ onSubmit }) {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [postcode, setPostcode] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !dob || !postcode.trim()) return;
    onSubmit({ name: name.trim(), dob, postcode: postcode.trim() });
  };

  return (
    <div className="mx-2 my-1 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-800">Please fill in your details to begin</p>
      </div>
      <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Full name *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John Doe"
            className="h-9 text-sm"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Date of birth *</label>
          <Input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="h-9 text-sm"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Postcode *</label>
          <Input
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.toUpperCase())}
            placeholder="SW1A 1AA"
            className="h-9 text-sm"
            required
          />
        </div>
        <Button type="submit" className="bg-blue-600 hover:bg-blue-700 h-9 gap-2 text-sm">
          Continue <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}